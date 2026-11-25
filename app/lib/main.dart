import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'data/bridge_client.dart';
import 'data/cache.dart';
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
          home: const StartScreen(),
        ),
      );
}

const _storage = FlutterSecureStorage();

/// Goes straight to the app when a bridge is saved; screens fall back to saved data if it is unreachable.
class StartScreen extends StatefulWidget {
  const StartScreen({super.key});
  @override
  State<StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<StartScreen> {
  BridgeClient? _client;
  bool _checked = false;

  @override
  void initState() {
    super.initState();
    _read();
  }

  Future<void> _read() async {
    try {
      final url = await _storage.read(key: 'bridge_url');
      final token = await _storage.read(key: 'bridge_token');
      if (url != null && url.isNotEmpty && token != null && token.isNotEmpty) {
        _client = BridgeClient(baseUrl: url, token: token, cache: PrefsCache());
      }
    } catch (_) {}
    if (mounted) setState(() => _checked = true);
  }

  Future<void> _disconnect() async {
    try {
      await PrefsCache().clear();
      await _storage.delete(key: 'bridge_token');
    } catch (_) {}
    if (mounted) setState(() => _client = null);
  }

  @override
  Widget build(BuildContext context) {
    if (!_checked) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final c = _client;
    if (c == null) return ConnectScreen(onConnected: (client) => setState(() => _client = client));
    return HomeShell(client: c, onDisconnect: _disconnect);
  }
}

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key, required this.onConnected});
  final ValueChanged<BridgeClient> onConnected;
  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final _url = TextEditingController();
  final _token = TextEditingController();
  String? _status;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      _url.text = await _storage.read(key: 'bridge_url') ?? '';
      _token.text = await _storage.read(key: 'bridge_token') ?? '';
    } catch (_) {}
  }

  Future<void> _connect() async {
    setState(() => _status = 'Connecting...');
    try {
      final v = await BridgeClient(baseUrl: _url.text.trim(), token: _token.text.trim()).health();
      await _storage.write(key: 'bridge_url', value: _url.text.trim());
      await _storage.write(key: 'bridge_token', value: _token.text.trim());
      setState(() => _status = 'Connected (Actual client $v)');
      if (!mounted) return;
      widget.onConnected(BridgeClient(baseUrl: _url.text.trim(), token: _token.text.trim(), cache: PrefsCache()));
    } on BridgeException catch (e) {
      setState(() => _status = e.message);
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
