import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../data/settings.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.client, required this.onDisconnect});
  final BridgeClient client;
  final VoidCallback onDisconnect;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Settings')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Text('Theme', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          ValueListenableBuilder<ThemeMode>(
            valueListenable: themeMode,
            builder: (_, mode, _) => SegmentedButton<ThemeMode>(
              segments: const [
                ButtonSegment(value: ThemeMode.system, label: Text('System')),
                ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
              ],
              selected: {mode},
              onSelectionChanged: (s) => setThemeMode(s.first),
            ),
          ),
          const SizedBox(height: 24),
          Text('Bridge', style: Theme.of(context).textTheme.titleMedium),
          ListTile(contentPadding: EdgeInsets.zero, title: Text(client.baseUrl), subtitle: const Text('Saved on this phone')),
          OutlinedButton(
            onPressed: () {
              Navigator.of(context).pop();
              onDisconnect();
            },
            child: const Text('Change bridge or token'),
          ),
        ]),
      );
}
