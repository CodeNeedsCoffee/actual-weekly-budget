import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:weekly_budget/data/bridge_client.dart';
import 'package:weekly_budget/data/models.dart';

void main() {
  inboxTests();
  syncTests();
  forecastTests();
  balancingTests();
  test('health returns client version and sends bearer token', () async {
    final mock = MockClient((req) async {
      expect(req.headers['Authorization'], 'Bearer t');
      return http.Response('{"ok":true,"apiClientVersion":"26.11.0"}', 200);
    });
    final c = BridgeClient(baseUrl: 'http://h:1/', token: 't', client: mock);
    expect(await c.health(), '26.11.0');
  });

  test('401 becomes a readable error', () async {
    final c = BridgeClient(
        baseUrl: 'http://h:1', token: 'x', client: MockClient((_) async => http.Response('', 401)));
    expect(c.health(), throwsA(isA<BridgeException>()));
  });
}

void inboxTests() {
  test('split posts the parts and maps 409 to a readable error', () async {
    var status = 200;
    final c = BridgeClient(
      baseUrl: 'http://h:1',
      token: 't',
      client: MockClient((req) async {
        expect(req.url.path, '/transactions/x/split');
        expect(req.body, contains('"percent":50'));
        return http.Response('{}', status);
      }),
    );
    await c.split('x', [{'categoryId': 'a', 'percent': 50}, {'categoryId': 'b'}]);
    status = 409;
    expect(c.split('x', [{'categoryId': 'a', 'percent': 50}, {'categoryId': 'b'}]), throwsA(isA<BridgeException>()));
  });

  test('uncategorized parses suggestions', () async {
    final c = BridgeClient(
      baseUrl: 'http://h:1',
      token: 't',
      client: MockClient((_) async => http.Response(
          '{"transactions":[{"id":"a","date":"2026-11-20","amount":-500,"payee":"Shop","account":"Checking","suggestion":{"categoryId":"c","categoryName":"Groceries","reason":"r"}},{"id":"b","date":"2026-11-19","amount":-100,"payee":"X","account":"Checking","suggestion":null}]}',
          200)),
    );
    final items = await c.uncategorized();
    expect(items.first.suggestion?.categoryName, 'Groceries');
    expect(items.last.suggestion, isNull);
  });
}

void syncTests() {
  test('syncStatus parses freshness and ago() formats it', () async {
    final c = BridgeClient(
      baseUrl: 'http://h:1',
      token: 't',
      client: MockClient((_) async => http.Response(
          '{"accounts":[{"id":"a","name":"Checking","hoursAgo":3.2,"latestTransaction":"2026-11-23","stale":false},{"id":"b","name":"Card","hoursAgo":null,"latestTransaction":null,"stale":true}]}',
          200)),
    );
    final a = await c.syncStatus();
    expect(a.first.stale, isFalse);
    expect(ago(a.first.hoursAgo), '3 h ago');
    expect(a.last.stale, isTrue);
    expect(ago(a.last.hoursAgo), 'never');
    expect(ago(0.2), 'just now');
    expect(ago(72), '3 d ago');
  });

  test('sync returns bank errors without throwing', () async {
    final c = BridgeClient(
      baseUrl: 'http://h:1',
      token: 't',
      client: MockClient((_) async => http.Response('{"ok":false,"error":"bank unreachable","accounts":[]}', 200)),
    );
    final r = await c.sync();
    expect(r.ok, isFalse);
    expect(r.error, 'bank unreachable');
  });
}

void forecastTests() {
  test('forecast and payoff parse', () async {
    final c = BridgeClient(
      baseUrl: 'http://h:1',
      token: 't',
      client: MockClient((req) async {
        if (req.url.path == '/forecast') {
          return http.Response(
              '{"status":"tight","startBalance":800000,"buffer":100000,"lowWithoutIncome":{"date":"2026-12-06","amount":90000},"lowWithIncome":{"date":"2026-12-06","amount":190000},"fix":{"moveFromSavings":10000,"before":"2026-12-06","stillShort":0},"path":[{"date":"2026-12-01","items":[{"name":"Rent","amount":-330000,"kind":"bill"}],"balanceWith":470000,"balanceWithout":470000}],"cardTotal":-1400,"warnings":[]}',
              200);
        }
        return http.Response('{"card":"Card","cardOwed":500000,"safeNow":200000,"safeTotal":395000,"afterIncome":195000,"incomeLateDays":7}', 200);
      }),
    );
    final f = await c.forecast();
    expect(f.status, 'tight');
    expect(f.moveFromSavings, 10000);
    expect(f.path.single.items.single.name, 'Rent');
    final p = await c.payoff();
    expect(p!.safeNow, 200000);
  });
}

void balancingTests() {
  test('proposal, apply and revert round trip', () async {
    final seen = <String>[];
    final c = BridgeClient(
      baseUrl: 'http://h:1',
      token: 't',
      client: MockClient((req) async {
        seen.add('${req.method} ${req.url.path}');
        if (req.url.path == '/balancing/proposal') {
          return http.Response(
              '{"id":"abc","from":"2026-06","to":"2026-10","totalAllocated":35151,"months":[{"month":"2026-06","surplus":35151,"used":0,"allocated":35151,"poolAfter":0,"overspentAfter":-100,"moves":[{"categoryId":"c","name":"Shopping","add":35151}]}],"cells":[]}',
              200);
        }
        if (req.url.path == '/balancing/revert') return http.Response('{"ok":false,"restored":1,"conflicts":[{"month":"m"}]}', 200);
        return http.Response('{"ok":true}', 200);
      }),
    );
    final p = await c.balancingProposal();
    expect(p.total, 35151);
    expect(p.months.single.moves.single.name, 'Shopping');
    await c.applyBalancing(p);
    expect(await c.revertBalancing('apply-1'), 1);
    expect(seen, ['GET /balancing/proposal', 'POST /balancing/apply', 'POST /balancing/revert']);
  });

  test('a stale plan is reported readably', () async {
    final c = BridgeClient(baseUrl: 'http://h:1', token: 't', client: MockClient((_) async => http.Response('{}', 409)));
    expect(
        c.applyBalancing(BalanceProposal(id: 'x', from: 'a', to: 'b', total: 0, months: [])), throwsA(isA<BridgeException>()));
  });
}
