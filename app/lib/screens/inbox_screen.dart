import 'package:flutter/material.dart';

import '../data/bridge_client.dart';
import '../data/models.dart';

class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key, required this.client});
  final BridgeClient client;
  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  List<InboxTransaction>? _items;
  List<BudgetCategory> _categories = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([widget.client.uncategorized(), widget.client.categories()]);
      setState(() {
        _items = results[0] as List<InboxTransaction>;
        _categories = results[1] as List<BudgetCategory>;
        _error = null;
      });
    } on BridgeException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _assign(InboxTransaction t, String categoryId) async {
    try {
      await widget.client.setCategory(t.id, categoryId);
      setState(() => _items = _items!.where((x) => x.id != t.id).toList());
    } on BridgeException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _split(InboxTransaction t) async {
    try {
      await widget.client.split(t.id, t.splitSuggestion!.parts);
      setState(() => _items = _items!.where((x) => x.id != t.id).toList());
    } on BridgeException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _pick(InboxTransaction t) async {
    final cats = _categories.where((c) => t.amount > 0 || !c.isIncome).toList();
    final chosen = await showModalBottomSheet<BudgetCategory>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, controller) => ListView(controller: controller, children: [
          for (final c in cats) ListTile(title: Text(c.name), subtitle: Text(c.group), onTap: () => Navigator.pop(context, c)),
        ]),
      ),
    );
    if (chosen != null) await _assign(t, chosen.id);
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(
        title: Text(items == null ? 'Inbox' : 'Inbox (${items.length})'),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: _error != null
          ? Center(child: Text(_error!))
          : items == null
              ? const Center(child: CircularProgressIndicator())
              : items.isEmpty
                  ? const Center(child: Text('Nothing to categorize'))
                  : ListView(children: [for (final t in items) _tile(t)]),
    );
  }

  Widget _tile(InboxTransaction t) {
    final s = t.suggestion;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(t.payee.isEmpty ? '(no payee)' : t.payee, style: Theme.of(context).textTheme.titleMedium)),
            Text(money(t.amount), style: const TextStyle(fontWeight: FontWeight.bold)),
          ]),
          Text('${t.date} · ${t.account}', style: Theme.of(context).textTheme.bodySmall),
          if (s != null) ...[
            const SizedBox(height: 6),
            Text(s.reason, style: Theme.of(context).textTheme.bodySmall),
          ],
          const SizedBox(height: 8),
          if (t.splitSuggestion != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: FilledButton.tonalIcon(
                onPressed: () => _split(t),
                icon: const Icon(Icons.call_split),
                label: Text(t.splitSuggestion!.label),
              ),
            ),
          Row(children: [
            if (s != null) FilledButton(onPressed: () => _assign(t, s.categoryId), child: Text(s.categoryName)),
            if (s != null) const SizedBox(width: 8),
            OutlinedButton(onPressed: () => _pick(t), child: Text(s == null ? 'Choose category' : 'Other')),
          ]),
        ]),
      ),
    );
  }
}
