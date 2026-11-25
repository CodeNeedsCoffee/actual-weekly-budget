import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../widgets/states.dart';
import 'settings_screen.dart';
import '../data/models.dart';

class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key, required this.client, this.onStaleChanged, this.onSynced, this.onDisconnect});
  final BridgeClient client;
  final ValueChanged<int>? onStaleChanged;
  final VoidCallback? onSynced;
  final VoidCallback? onDisconnect;
  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  List<AccountSync>? _accounts;
  String? _error;
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _set(List<AccountSync> accounts) {
    setState(() {
      _accounts = accounts;
      _error = null;
    });
    widget.onStaleChanged?.call(accounts.where((a) => a.stale).length);
  }

  Future<void> _load() async {
    try {
      _set(await widget.client.syncStatus());
    } on BridgeException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _sync() async {
    setState(() => _syncing = true);
    try {
      final r = await widget.client.sync();
      _set(r.accounts);
      if (!r.ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.error ?? 'Sync failed')));
      }
      if (r.ok) widget.onSynced?.call();
    } on BridgeException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accounts = _accounts;
    return Scaffold(
      appBar: AppBar(title: const Text('Accounts'), actions: [
        IconButton(onPressed: _syncing ? null : _load, icon: const Icon(Icons.refresh)),
        IconButton(
          tooltip: 'Settings',
          icon: const Icon(Icons.settings),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => SettingsScreen(client: widget.client, onDisconnect: widget.onDisconnect ?? () {}))),
        ),
      ]),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _syncing ? null : _sync,
        icon: _syncing
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.sync),
        label: Text(_syncing ? 'Syncing...' : 'Sync now'),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : accounts == null
              ? const Center(child: CircularProgressIndicator())
              : accounts.isEmpty
                  ? const EmptyView(icon: Icons.account_balance, message: 'No accounts found')
                  : ListView(children: [
                  for (final a in accounts)
                    ListTile(
                      leading: Icon(a.stale ? Icons.warning_amber : Icons.check_circle_outline,
                          color: a.stale ? Theme.of(context).colorScheme.error : Colors.green),
                      title: Text(a.name),
                      subtitle: Text('Synced ${ago(a.hoursAgo)} · latest transaction ${a.latestTransaction ?? 'none'}'),
                      trailing: a.stale ? const Text('Stale') : null,
                    ),
                ]),
    );
  }
}
