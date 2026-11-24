import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
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

  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(index: _index, children: [
          WeekScreen(client: widget.client),
          InboxScreen(client: widget.client),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.calendar_view_week), label: 'This week'),
            NavigationDestination(icon: Icon(Icons.inbox), label: 'Inbox'),
          ],
        ),
      );
}
