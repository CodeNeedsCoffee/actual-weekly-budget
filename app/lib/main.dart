import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'data/bridge_client.dart';
import 'data/cache.dart';
import 'data/vault.dart';
import 'data/settings.dart';
import 'screens/home_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await loadSettings();
  runApp(const ProviderScope(child: WeeklyBudgetApp()));
}

class WeeklyBudgetApp extends StatelessWidget {
  const WeeklyBudgetApp({super.key});

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<ThemeMode>(
        valueListenable: themeMode,
        builder: (_, mode, _) => MaterialApp(
          title: 'Weekly Grind',
          themeMode: mode,
          theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
          darkTheme: ThemeData(colorSchemeSeed: Colors.teal, brightness: Brightness.dark, useMaterial3: true),
          home: const AppLock(),
        ),
      );
}

/// How long the app can sit in the background before it asks for biometrics again.
const lockAfter = Duration(seconds: 30);

/// Keeps the app locked until the device owner proves it is them (biometrics, or the device PIN).
/// The saved login and the key that encrypts the offline copy are only released by that check.
class AppLock extends StatefulWidget {
  const AppLock({super.key});
  @override
  State<AppLock> createState() => _AppLockState();
}

class _AppLockState extends State<AppLock> with WidgetsBindingObserver {
  final _vault = Vault();
  BridgeClient? _client;
  bool _locked = true; // true until the check passes
  bool _busy = false;
  bool _hidden = false; // the app is not in the foreground: cover it so recents shows nothing
  bool _needsLogin = false;
  String? _message;
  String? _notice; // shown on the connect screen
  DateTime? _pausedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _unlock();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final away = state != AppLifecycleState.resumed;
    if (state == AppLifecycleState.paused) _pausedAt ??= DateTime.now();
    if (state == AppLifecycleState.resumed) {
      final since = _pausedAt;
      _pausedAt = null;
      if (!_locked && since != null && DateTime.now().difference(since) > lockAfter) {
        setState(() => _locked = true);
        _unlock();
      }
    }
    if (_hidden != away) setState(() => _hidden = away);
  }

  Future<void> _unlock() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      var s = await _vault.open();
      await EncryptedCache.removeLegacy();
      String? notice;
      if (s != null) {
        try {
          BridgeClient.checkAddress(s.url, allowInsecure: kDebugMode);
        } on BridgeException {
          // A login saved by an older version over plain http: drop it, the token may have been exposed.
          await _vault.wipe();
          s = null;
          notice = 'The saved address did not use https, so it was removed. Enter an https address, and change the token on the bridge.';
        }
      }
      if (!mounted) return;
      setState(() {
        _client = s == null ? null : _clientFor(s);
        _needsLogin = s == null;
        _notice = notice;
        _locked = false;
      });
    } catch (_) {
      if (mounted) setState(() => _message = 'Not unlocked. Use your fingerprint or device PIN.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  BridgeClient _clientFor(Session s) => BridgeClient(
        baseUrl: s.url,
        token: s.token,
        cache: EncryptedCache(s.cacheKey),
        allowInsecure: kDebugMode, // release builds only ever talk https
        accessId: s.accessId,
        accessSecret: s.accessSecret,
      );

  Future<void> _saveLogin(String url, String token, String? accessId, String? accessSecret) async {
    final s = Session.create(url: url, token: token, accessId: accessId, accessSecret: accessSecret);
    await _vault.save(s); // asks for biometrics once more to protect the new login
    if (!mounted) return;
    setState(() {
      _client = _clientFor(s);
      _needsLogin = false;
    });
  }

  Future<void> _disconnect() async {
    try {
      await _client?.cache?.clear();
    } catch (_) {}
    await _vault.wipe();
    if (mounted) {
      setState(() {
        _client = null;
        _needsLogin = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final Widget body;
    if (_locked) {
      body = _LockScreen(busy: _busy, message: _message, onUnlock: _unlock);
    } else if (_needsLogin || _client == null) {
      body = ConnectScreen(onConnect: _saveLogin, notice: _notice);
    } else {
      body = HomeShell(client: _client!, onDisconnect: _disconnect);
    }
    return Stack(children: [
      Positioned.fill(child: body),
      if (_hidden && !_locked) const Positioned.fill(child: _Cover()),
    ]);
  }
}

class _Cover extends StatelessWidget {
  const _Cover();
  @override
  Widget build(BuildContext context) => ColoredBox(
        color: Theme.of(context).colorScheme.surface,
        child: Center(child: Icon(Icons.lock_outline, size: 64, color: Theme.of(context).colorScheme.outline)),
      );
}

class _LockScreen extends StatelessWidget {
  const _LockScreen({required this.busy, required this.message, required this.onUnlock});
  final bool busy;
  final String? message;
  final VoidCallback onUnlock;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.lock_outline, size: 64, color: Theme.of(context).colorScheme.primary),
              const SizedBox(height: 16),
              Text('Weekly Grind is locked', style: Theme.of(context).textTheme.titleLarge),
              if (message != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(message!, textAlign: TextAlign.center)),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: busy ? null : onUnlock,
                icon: const Icon(Icons.fingerprint),
                label: const Text('Unlock'),
              ),
            ]),
          ),
        ),
      );
}

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key, required this.onConnect, this.notice});
  final Future<void> Function(String url, String token, String? accessId, String? accessSecret) onConnect;
  final String? notice;
  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final _url = TextEditingController();
  final _token = TextEditingController();
  final _accessId = TextEditingController();
  final _accessSecret = TextEditingController();
  String? _status;

  Future<void> _connect() async {
    final token = _token.text.trim();
    final id = _accessId.text.trim(), secret = _accessSecret.text.trim();
    if (id.isEmpty != secret.isEmpty) {
      setState(() => _status = 'Enter both the Access client ID and secret, or neither.');
      return;
    }
    try {
      final url = BridgeClient.checkAddress(_url.text, allowInsecure: kDebugMode);
      setState(() => _status = 'Connecting...');
      final v = await BridgeClient(
        baseUrl: url,
        token: token,
        allowInsecure: kDebugMode,
        accessId: id.isEmpty ? null : id,
        accessSecret: secret.isEmpty ? null : secret,
      ).health();
      setState(() => _status = 'Connected (Actual client $v). Confirm to save the login securely.');
      await widget.onConnect(url, token, id.isEmpty ? null : id, secret.isEmpty ? null : secret);
    } on BridgeException catch (e) {
      setState(() => _status = e.message);
    } catch (_) {
      setState(() => _status = 'Could not save the login. Try again and confirm with your fingerprint or PIN.');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Weekly Grind')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: ListView(children: [
            if (widget.notice != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(widget.notice!)),
            TextField(
                controller: _url,
                decoration: const InputDecoration(labelText: 'Bridge address (https://...)'),
                keyboardType: TextInputType.url),
            TextField(
                controller: _token,
                decoration: const InputDecoration(labelText: 'Token'),
                obscureText: true),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text('Cloudflare Access (optional)'),
              children: [
                TextField(controller: _accessId, decoration: const InputDecoration(labelText: 'Access client ID'), autocorrect: false),
                TextField(controller: _accessSecret, decoration: const InputDecoration(labelText: 'Access client secret'), obscureText: true),
              ],
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _connect, child: const Text('Connect')),
            if (_status != null) Padding(padding: const EdgeInsets.all(12), child: Text(_status!)),
          ]),
        ),
      );
}
