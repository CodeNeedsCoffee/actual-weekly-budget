import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import 'accounts_screen.dart';
import 'inbox_screen.dart';
import 'week_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.client});
  final BridgeClient client;
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  int _stale = 0;
  int _reload = 0; // bumps to rebuild the data screens after a sync

  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(index: _index, children: [
          WeekScreen(key: ValueKey('week$_reload'), client: widget.client),
          InboxScreen(key: ValueKey('inbox$_reload'), client: widget.client),
          AccountsScreen(
            client: widget.client,
            onStaleChanged: (n) => setState(() => _stale = n),
            onSynced: () => setState(() => _reload++),
          ),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: [
            const NavigationDestination(icon: Icon(Icons.calendar_view_week), label: 'This week'),
            const NavigationDestination(icon: Icon(Icons.inbox), label: 'Inbox'),
            NavigationDestination(
              icon: Badge(isLabelVisible: _stale > 0, label: Text('$_stale'), child: const Icon(Icons.account_balance)),
              label: 'Accounts',
            ),
          ],
        ),
      );
}
