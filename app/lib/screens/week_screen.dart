import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../data/models.dart';

class WeekScreen extends StatefulWidget {
  const WeekScreen({super.key, required this.client});
  final BridgeClient client;
  @override
  State<WeekScreen> createState() => _WeekScreenState();
}

class _WeekScreenState extends State<WeekScreen> {
  late Future<List<CategoryWeek>> _data = widget.client.weekly();

  void _refresh() => setState(() => _data = widget.client.weekly());

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('This week'), actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
        ]),
        body: FutureBuilder<List<CategoryWeek>>(
          future: _data,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) return Center(child: Text('${snap.error}'));
            final cats = snap.data!;
            return ListView(children: [
              for (final c in cats)
                ListTile(
                  title: Text(c.name),
                  subtitle: Text(c.overspent > 0
                      ? 'Overspent ${money(c.overspent)}'
                      : 'Month left ${money(c.monthRemaining)}'),
                  trailing: Text(money(c.remainingThisWeek),
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: c.remainingThisWeek < 0 ? Theme.of(context).colorScheme.error : null)),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => AffordScreen(client: widget.client, category: c))),
                ),
            ]);
          },
        ),
      );
}

class AffordScreen extends StatefulWidget {
  const AffordScreen({super.key, required this.client, required this.category});
  final BridgeClient client;
  final CategoryWeek category;
  @override
  State<AffordScreen> createState() => _AffordScreenState();
}

class _AffordScreenState extends State<AffordScreen> {
  final _amount = TextEditingController();
  AffordResult? _result;
  String? _error;

  Future<void> _check() async {
    final cents = parseCents(_amount.text);
    if (cents == null || cents == 0) {
      setState(() => _error = 'Enter an amount');
      return;
    }
    try {
      final r = await widget.client.afford(cents, widget.category.id);
      setState(() {
        _result = r;
        _error = null;
      });
    } on BridgeException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    final color = switch (r?.verdict) {
      'yes' => Colors.green,
      'tight' => Colors.orange,
      'no' => Theme.of(context).colorScheme.error,
      _ => null,
    };
    return Scaffold(
      appBar: AppBar(title: Text(widget.category.name)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Left this week: ${money(widget.category.remainingThisWeek)}'),
          Text('Left this month: ${money(widget.category.monthRemaining)}'),
          const SizedBox(height: 16),
          TextField(
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Can I afford', prefixText: '\$'),
            onSubmitted: (_) => _check(),
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: _check, child: const Text('Check')),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!)),
          if (r != null) ...[
            const SizedBox(height: 16),
            Text(r.verdict.toUpperCase(),
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: color)),
            Text(r.reason),
            Text('This week after: ${money(r.remainingThisWeekAfter)}'),
            Text('This month after: ${money(r.monthRemainingAfter)}'),
          ],
        ]),
      ),
    );
  }
}
