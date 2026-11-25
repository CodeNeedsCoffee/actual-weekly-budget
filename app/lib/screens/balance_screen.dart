import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../widgets/states.dart';
import '../data/models.dart';

class BalanceScreen extends StatefulWidget {
  const BalanceScreen({super.key, required this.client, this.onChanged});
  final BridgeClient client;
  final VoidCallback? onChanged;
  @override
  State<BalanceScreen> createState() => _BalanceScreenState();
}

class _BalanceScreenState extends State<BalanceScreen> {
  BalanceProposal? _proposal;
  Recovery? _recovery;
  RebalanceProposal? _rebalance;
  SweepProposal? _sweep;
  int? _sweepAmount; // cents; null = all free money
  final _sweepField = TextEditingController();
  bool _includeSavings = false;
  List<BalanceLogEntry> _log = [];
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.client.balancingProposal(),
        widget.client.balancingLog(),
        widget.client.rebalanceProposal(includeSavings: _includeSavings),
        widget.client.sweepProposal(amount: _sweepAmount),
        widget.client.recovery(),
      ]);
      setState(() {
        _proposal = results[0] as BalanceProposal;
        _log = (results[1] as List<BalanceLogEntry>).reversed.toList();
        _rebalance = results[2] as RebalanceProposal;
        _sweep = results[3] as SweepProposal;
        _recovery = results[4] as Recovery;
        _error = null;
      });
    } on BridgeException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<bool> _confirm(String title, String body, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(action)),
          ],
        ),
      ) ??
      false;

  Future<void> _run(Future<void> Function() action, {String? done}) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
      widget.onChanged?.call();
      if (done != null && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } on BridgeException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _apply(BalanceProposal p) async {
    final ok = await _confirm('Apply extra income?',
        'Raises ${p.months.fold<int>(0, (s, m) => s + m.moves.length)} budgets by ${money(p.total)} in total. You can undo it afterwards.', 'Apply');
    if (ok) await _run(() => widget.client.applyBalancing(p), done: 'Applied ${money(p.total)}');
  }

  Future<void> _applyRebalance(RebalanceProposal r) async {
    final ok = await _confirm('Rebalance ${r.to}?',
        'Moves ${money(r.total)} between ${r.moves.length} budget moves. Savings ${r.includeSavings ? 'may be used, last' : 'is not touched'}. You can undo it afterwards.', 'Apply');
    if (ok) await _run(() => widget.client.applyRebalance(r), done: 'Moved ${money(r.total)}');
  }

  Widget _rebalanceCard(BuildContext context, RebalanceProposal r) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Rebalance ${r.to}', style: Theme.of(context).textTheme.titleMedium),
            if (r.total > 0) ...[
              Text(money(r.total), style: Theme.of(context).textTheme.headlineMedium),
              const Text('Moved from budgets with spare money into overspent ones.'),
              const SizedBox(height: 8),
              for (final mv in r.moves.take(6))
                Text('${mv.from} → ${mv.to}  ${money(mv.amount)}', style: Theme.of(context).textTheme.bodySmall),
              if (r.moves.length > 6)
                Text('and ${r.moves.length - 6} more', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 8),
              Text('Still overspent after: ${money(r.overspentAfter.abs())}'),
            ] else
              const Text('Nothing to move: no budget has spare money to cover an overspent one.'),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Also use Savings (last)'),
              value: _includeSavings,
              onChanged: _busy
                  ? null
                  : (v) {
                      setState(() => _includeSavings = v);
                      _load();
                    },
            ),
            if (r.total > 0) FilledButton(onPressed: _busy ? null : () => _applyRebalance(r), child: const Text('Apply rebalance')),
          ]),
        ),
      );

  Widget _recoveryCard(BuildContext context, Recovery r) {
    final done = r.overspentNow == 0;
    final style = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(done ? 'Recovery' : 'Left to recover', style: style.titleMedium),
          Text(done ? 'Back on budget' : money(r.leftToRecover), style: style.headlineMedium),
          Text(done
              ? 'Nothing is overspent right now.'
              : r.leftToRecover == 0
                  ? 'Unspent extra income covers what is overspent.'
                  : 'Still to cover with bonus money or transfers.'),
          const SizedBox(height: 8),
          Text('Overspent now: ${money(r.overspentNow)}'),
          Text('Extra income applied: ${money(r.applied)}'),
          Text('Extra income not yet used: ${money(r.poolRemaining)}'),
          const SizedBox(height: 8),
          for (final m in r.months)
            Row(children: [
              Expanded(child: Text(m.complete ? m.month : '${m.month} (so far)', style: style.bodySmall)),
              Text(m.overspent == 0 ? 'on budget' : 'over ${money(m.overspent)}', style: style.bodySmall),
            ]),
        ]),
      ),
    );
  }

  Future<void> _applySweep(SweepProposal s) async {
    final unsafe = s.cash != null && !s.cash!.safe;
    final ok = await _confirm('Move ${money(s.total)} to Savings?',
        'Lowers ${s.takes.length} budgets and raises the Savings budget by ${money(s.total)}.'
        '${unsafe ? '\n\nMoving that much cash from Checking could leave it at ${money(s.cash!.lowAfter)} around ${s.cash!.lowDate}.' : ''}'
        ' You can undo it afterwards.',
        'Apply');
    if (ok) await _run(() => widget.client.applySweep(s, amount: _sweepAmount), done: 'Moved ${money(s.total)} to Savings');
  }

  Widget _sweepCard(BuildContext context, SweepProposal s) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Move to Savings (${s.month})', style: Theme.of(context).textTheme.titleMedium),
            if (s.free > 0) ...[
              Text('Free to move: ${money(s.free)}', style: Theme.of(context).textTheme.headlineSmall),
              const Text('Spare budget left after every overspent budget is covered.'),
              const SizedBox(height: 8),
              for (final t in s.takes.take(5)) Text('${t.name}  ${money(t.amount)}', style: Theme.of(context).textTheme.bodySmall),
              if (s.takes.length > 5) Text('and ${s.takes.length - 5} more', style: Theme.of(context).textTheme.bodySmall),
              TextField(
                controller: _sweepField,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount (blank = all free money)', prefixText: '\$'),
                onSubmitted: (v) {
                  _sweepAmount = v.trim().isEmpty ? null : parseCents(v);
                  _load();
                },
              ),
              if (s.cash != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    s.cash!.safe
                        ? 'Cash check: Checking stays above your buffer if you move ${money(s.total)}.'
                        : 'Cash check: moving ${money(s.total)} of real cash could leave Checking at ${money(s.cash!.lowAfter)} around ${s.cash!.lowDate}.',
                    style: TextStyle(color: s.cash!.safe ? null : Theme.of(context).colorScheme.error),
                  ),
                ),
              const SizedBox(height: 8),
              FilledButton(onPressed: _busy || s.total == 0 ? null : () => _applySweep(s), child: Text('Move ${money(s.total)}')),
            ] else
              Text(s.stillOverspent < 0
                  ? 'Nothing free: overspent budgets use all the spare money (${money(s.stillOverspent.abs())} still overspent).'
                  : 'Nothing free to move.'),
          ]),
        ),
      );

  Future<void> _revert(BalanceLogEntry e) async {
    final ok = await _confirm('Undo this change?', 'Restores the budget amounts from before (${money(e.total)}).', 'Undo');
    if (!ok) return;
    await _run(() async {
      final conflicts = await widget.client.revertBalancing(e.id);
      if (conflicts > 0 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$conflicts budgets were changed since and were left alone')));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = _proposal;
    return Scaffold(
      appBar: AppBar(title: const Text('Month end'), actions: [
        IconButton(onPressed: _busy ? null : _load, icon: const Icon(Icons.refresh)),
      ]),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : p == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(padding: const EdgeInsets.all(16), children: [
                  if (_recovery != null) _recoveryCard(context, _recovery!),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(p.total > 0 ? 'Extra income to spend' : 'Nothing to apply',
                            style: Theme.of(context).textTheme.titleMedium),
                        if (p.total > 0) ...[
                          Text(money(p.total), style: Theme.of(context).textTheme.headlineMedium),
                          const Text('Income above your base, spent on the most overspent budgets first.'),
                          const SizedBox(height: 12),
                          FilledButton(onPressed: _busy ? null : () => _apply(p), child: const Text('Apply')),
                        ] else
                          const Text('All extra income in this range has been used, or none came in.'),
                      ]),
                    ),
                  ),
                  if (_rebalance != null) _rebalanceCard(context, _rebalance!),
                  if (_sweep != null) _sweepCard(context, _sweep!),
                  for (final m in p.months)
                    ExpansionTile(
                      title: Text(m.month),
                      subtitle: Text('Extra ${money(m.surplus - m.used)} · overspent after ${money(m.overspentAfter.abs())}'),
                      trailing: m.allocated > 0 ? Text('+${money(m.allocated)}') : null,
                      children: [
                        for (final mv in m.moves) ListTile(dense: true, title: Text(mv.name), trailing: Text('+${money(mv.add)}')),
                        if (m.moves.isEmpty)
                          const ListTile(dense: true, title: Text('No change this month')),
                      ],
                    ),
                  if (_log.isNotEmpty) ...[
                    const Padding(padding: EdgeInsets.only(top: 16, bottom: 4), child: Text('History')),
                    for (final e in _log)
                      ListTile(
                        title: Text('${{'apply': 'Extra income applied', 'rebalance': 'Rebalanced', 'sweep': 'Moved to Savings', 'manual': 'Recorded'}[e.kind] ?? e.kind} ${money(e.total)}'),
                        subtitle: Text(e.at.substring(0, 10)),
                        trailing: TextButton(onPressed: _busy ? null : () => _revert(e), child: const Text('Undo')),
                      ),
                  ],
                ]),
    );
  }
}
