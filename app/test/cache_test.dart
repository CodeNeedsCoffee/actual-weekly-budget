import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:weekly_budget/data/cache.dart';
import 'package:weekly_budget/data/vault.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('round trip, and nothing readable is stored', () async {
    final c = EncryptedCache(Session.randomKey());
    await c.put('http://h/weekly', '{"secret":"Groceries 1234.56"}');
    final got = await c.get('http://h/weekly');
    expect(got!.body, '{"secret":"Groceries 1234.56"}');
    final p = await SharedPreferences.getInstance();
    final stored = p.getKeys().map((k) => p.getString(k)).join();
    expect(stored.contains('Groceries'), isFalse);
    expect(stored.contains('1234'), isFalse);
    expect(p.getKeys().any((k) => k.contains('weekly') || k.contains('http')), isFalse);
  });

  test('a different key, a moved entry or a tampered entry reads as missing', () async {
    final key = Session.randomKey();
    await EncryptedCache(key).put('a', 'one');
    expect(await EncryptedCache(Session.randomKey()).get('a'), isNull);

    final p = await SharedPreferences.getInstance();
    final nameA = p.getKeys().firstWhere((k) => k.startsWith('ecache:'));
    await EncryptedCache(key).put('b', 'two');
    final nameB = p.getKeys().firstWhere((k) => k.startsWith('ecache:') && k != nameA);
    await p.setString(nameB, p.getString(nameA)!); // the bytes of one entry moved under another path
    expect(await EncryptedCache(key).get('b'), isNull);

    final v = p.getString(nameA)!;
    await p.setString(nameA, '${v.substring(0, v.length - 6)}AAAAA=');
    expect(await EncryptedCache(key).get('a'), isNull);
  });

  test('clear and removeLegacy delete saved copies, including old plain-text ones', () async {
    SharedPreferences.setMockInitialValues({'cache:old': '1|{"x":1}', 'ecache:http://h/weekly': '1|abc', 'theme': 'dark'});
    final c = EncryptedCache(Session.randomKey());
    await c.put('a', 'one');
    await EncryptedCache.removeLegacy();
    var p = await SharedPreferences.getInstance();
    expect(p.getString('cache:old'), isNull);
    expect(p.getString('ecache:http://h/weekly'), isNull);
    expect((await EncryptedCache(Session.randomKey()).get('a')), isNull);
    expect(p.getKeys().where((k) => k.startsWith('ecache:')).length, 1); // the hashed entry survives
    expect(p.getString('theme'), 'dark');
    await c.clear();
    p = await SharedPreferences.getInstance();
    expect(p.getKeys(), {'theme'});
  });

  test('a session survives JSON and a new one gets a fresh 32-byte key', () {
    final s = Session.create(url: 'http://h:1', token: 't');
    final back = Session.fromJson(s.toJson());
    expect(back.cacheKey, s.cacheKey);
    expect(back.cacheKey.length, 32);
    expect(Session.create(url: 'u', token: 't').cacheKey, isNot(s.cacheKey));
  });
}
