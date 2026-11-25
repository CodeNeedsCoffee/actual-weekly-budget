import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../data/models.dart';

class ForecastScreen extends StatefulWidget {
  const ForecastScreen({super.key, required this.client, this.onStatus});
  final BridgeClient client;
  final ValueChanged<String>? onStatus;
  @override
  State<ForecastScreen> createState() => _ForecastScreenState();
}

class _ForecastScreenState extends State<ForecastScreen> {
  Forecast? _fc;
  Payoff? _payoff;
  String? _error;
  bool _withIncome = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([widget.client.forecast(), widget.client.payoff()]);
      final fc = results[0] as Forecast;
      setState(() {
        _fc = fc;
        _payoff = results[1] as Payoff?;
        _error = null;
      });
      widget.onStatus?.call(fc.status);
    } on BridgeException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fc = _fc;
    return Scaffold(
      appBar: AppBar(title: const Text('Next 14 days'), actions: [
        IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
      ]),
      body: _error != null
          ? Center(child: Text(_error!))
          : fc == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(padding: const EdgeInsets.all(16), children: [
                  _statusCard(context, fc),
                  if (_payoff != null) _payoffCard(context, _payoff!),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    title: const Text('Count expected income'),
                    subtitle: const Text('Off shows the balance if no paycheck arrives'),
                    value: _withIncome,
                    onChanged: (v) => setState(() => _withIncome = v),
                  ),
                  for (final d in fc.path.where((d) => d.items.isNotEmpty)) _dayTile(context, d),
                  if (fc.cardTotal != 0)
                    ListTile(
                      leading: const Icon(Icons.credit_card),
                      title: const Text('On cards, not yet in Checking'),
                      trailing: Text(money(fc.cardTotal)),
                    ),
                  for (final w in fc.warnings) Text(w, style: Theme.of(context).textTheme.bodySmall),
                ]),
    );
  }

  Widget _statusCard(BuildContext context, Forecast fc) {
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (fc.status) {
      'bounce' => ('Checking would go negative', scheme.error),
      'tight' => ('Checking gets tight', Colors.orange),
      _ => ('Checking looks fine', Colors.green),
    };
    final low = _withIncome ? fc.lowWithAmount : fc.lowAmount;
    final lowDate = _withIncome ? fc.lowWithDate : fc.lowDate;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: color)),
          const SizedBox(height: 8),
          Text('Now ${money(fc.startBalance)}'),
          Text('Lowest ${money(low)} on $lowDate'),
          Text('Buffer ${money(fc.buffer)}', style: Theme.of(context).textTheme.bodySmall),
          if (fc.moveFromSavings != null) ...[
            const Divider(),
            Text('Move ${money(fc.moveFromSavings!)} from Savings before ${fc.fixBefore}'),
            if (fc.stillShort > 0) Text('Still ${money(fc.stillShort)} short after that', style: TextStyle(color: scheme.error)),
          ],
        ]),
      ),
    );
  }

  Widget _payoffCard(BuildContext context, Payoff p) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Paying down ${p.card}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text('Owed ${money(p.cardOwed)}'),
            Text('Safe to pay now: ${money(p.safeNow)}', style: const TextStyle(fontWeight: FontWeight.bold)),
            if (p.afterIncome > 0) Text('After payday: ${money(p.afterIncome)} more (${money(p.safeTotal)} in total)'),
            Text('Survives a paycheck up to ${p.incomeLateDays} days late, keeps your buffer',
                style: Theme.of(context).textTheme.bodySmall),
          ]),
        ),
      );

  Widget _dayTile(BuildContext context, ForecastDay d) {
    final bal = _withIncome ? d.balanceWith : d.balanceWithout;
    final low = bal < 0;
    return ListTile(
      title: Text(d.date),
      subtitle: Text([for (final i in d.items) '${i.name} ${money(i.amount)}'].join('\n')),
      isThreeLine: d.items.length > 1,
      trailing: Text(money(bal),
          style: TextStyle(fontWeight: FontWeight.bold, color: low ? Theme.of(context).colorScheme.error : null)),
    );
  }
}
