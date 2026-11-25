import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../data/models.dart';
import 'accounts_screen.dart';
import 'balance_screen.dart';
import 'forecast_screen.dart';
import 'inbox_screen.dart';
import 'week_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.client, this.onDisconnect});
  final BridgeClient client;
  final VoidCallback? onDisconnect;
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  int _stale = 0;
  String _fcStatus = 'ok';
  int _reload = 0; // bumps to rebuild the data screens after a sync

  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(index: _index, children: [
          WeekScreen(key: ValueKey('week$_reload'), client: widget.client),
          InboxScreen(key: ValueKey('inbox$_reload'), client: widget.client),
          ForecastScreen(key: ValueKey('forecast$_reload'), client: widget.client, onStatus: (s) => setState(() => _fcStatus = s)),
          BalanceScreen(key: ValueKey('balance$_reload'), client: widget.client, onChanged: () => setState(() => _reload++)),
          AccountsScreen(
            client: widget.client,
            onStaleChanged: (n) => setState(() => _stale = n),
            onSynced: () => setState(() => _reload++),
            onDisconnect: widget.onDisconnect,
          ),
        ]),
        bottomNavigationBar: Column(mainAxisSize: MainAxisSize.min, children: [
          ValueListenableBuilder<DateTime?>(
            valueListenable: widget.client.offlineSince,
            builder: (context, since, _) => since == null
                ? const SizedBox.shrink()
                : Material(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(children: [
                        const Icon(Icons.cloud_off, size: 18),
                        const SizedBox(width: 8),
                        Expanded(child: Text('Offline: showing data saved ${ago(DateTime.now().difference(since).inMinutes / 60)}')),
                      ]),
                    ),
                  ),
          ),
          NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: [
            const NavigationDestination(icon: Icon(Icons.calendar_view_week), label: 'This week'),
            const NavigationDestination(icon: Icon(Icons.inbox), label: 'Inbox'),
            NavigationDestination(
              icon: Badge(isLabelVisible: _fcStatus != 'ok', backgroundColor: _fcStatus == 'bounce' ? Colors.red : Colors.orange, child: const Icon(Icons.timeline)),
              label: 'Forecast',
            ),
            const NavigationDestination(icon: Icon(Icons.balance), label: 'Month end'),
            NavigationDestination(
              icon: Badge(isLabelVisible: _stale > 0, label: Text('$_stale'), child: const Icon(Icons.account_balance)),
              label: 'Accounts',
            ),
          ],
        ),
        ]),
      );
}
