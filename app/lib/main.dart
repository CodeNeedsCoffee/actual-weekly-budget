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
          title: 'Weekly Budget',
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
      final s = await _vault.open();
      await EncryptedCache.removeLegacy();
      if (!mounted) return;
      setState(() {
        _client = s == null ? null : _clientFor(s);
        _needsLogin = s == null;
        _locked = false;
      });
    } catch (_) {
      if (mounted) setState(() => _message = 'Not unlocked. Use your fingerprint or device PIN.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  BridgeClient _clientFor(Session s) =>
      BridgeClient(baseUrl: s.url, token: s.token, cache: EncryptedCache(s.cacheKey));

  Future<void> _saveLogin(String url, String token) async {
    final s = Session.create(url: url, token: token);
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
      body = ConnectScreen(onConnect: _saveLogin);
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
              Text('Weekly Budget is locked', style: Theme.of(context).textTheme.titleLarge),
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
  const ConnectScreen({super.key, required this.onConnect});
  final Future<void> Function(String url, String token) onConnect;
  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final _url = TextEditingController();
  final _token = TextEditingController();
  String? _status;

  Future<void> _connect() async {
    final url = _url.text.trim(), token = _token.text.trim();
    setState(() => _status = 'Connecting...');
    try {
      final v = await BridgeClient(baseUrl: url, token: token).health();
      setState(() => _status = 'Connected (Actual client $v). Confirm to save the login securely.');
      await widget.onConnect(url, token);
    } on BridgeException catch (e) {
      setState(() => _status = e.message);
    } catch (_) {
      setState(() => _status = 'Could not save the login. Try again and confirm with your fingerprint or PIN.');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Weekly Budget')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            TextField(
                controller: _url,
                decoration: const InputDecoration(labelText: 'Bridge address'),
                keyboardType: TextInputType.url),
            TextField(
                controller: _token,
                decoration: const InputDecoration(labelText: 'Token'),
                obscureText: true),
            const SizedBox(height: 16),
            FilledButton(onPressed: _connect, child: const Text('Connect')),
            if (_status != null) Padding(padding: const EdgeInsets.all(12), child: Text(_status!)),
          ]),
        ),
      );
}
