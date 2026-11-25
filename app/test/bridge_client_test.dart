import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:weekly_budget/data/bridge_client.dart';
import 'package:weekly_budget/data/models.dart';

void main() {
  inboxTests();
  syncTests();
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
