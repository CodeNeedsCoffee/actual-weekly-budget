import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:weekly_budget/data/bridge_client.dart';

void main() {
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
