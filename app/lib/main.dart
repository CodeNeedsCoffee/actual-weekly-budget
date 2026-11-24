import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'data/bridge_client.dart';
import 'screens/week_screen.dart';

void main() => runApp(const ProviderScope(child: WeeklyBudgetApp()));

class WeeklyBudgetApp extends StatelessWidget {
  const WeeklyBudgetApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Weekly Budget',
        theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
        darkTheme: ThemeData(
            colorSchemeSeed: Colors.teal, brightness: Brightness.dark, useMaterial3: true),
        home: const ConnectScreen(),
      );
}

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key});
  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  static const _storage = FlutterSecureStorage();
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
      Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => WeekScreen(client: BridgeClient(baseUrl: _url.text.trim(), token: _token.text.trim()))));
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
