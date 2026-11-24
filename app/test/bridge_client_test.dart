import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:weekly_budget/data/bridge_client.dart';

void main() {
  inboxTests();
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
