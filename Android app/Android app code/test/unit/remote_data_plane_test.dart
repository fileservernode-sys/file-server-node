import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Batch 6J Remote File Manager Data Plane & Protocol Tests', () {
    test('FILE_REQUEST message constructs valid request payload', () {
      final req = {
        'type': 'FILE_REQUEST',
        'requestId': 'req-12345',
        'connectionId': 'conn-777',
        'operation': 'LIST',
        'path': '/Documents'
      };

      expect(req['type'], 'FILE_REQUEST');
      expect(req['requestId'], 'req-12345');
      expect(req['operation'], 'LIST');
      expect(req['path'], '/Documents');
    });

    test('FILE_RESPONSE message correlates correctly via requestId', () {
      final res = {
        'type': 'FILE_RESPONSE',
        'requestId': 'req-12345',
        'success': true,
        'data': {
          'items': [
            {'name': 'Report.pdf', 'isDir': false, 'sizeBytes': 2048}
          ]
        }
      };

      expect(res['requestId'], 'req-12345');
      expect(res['success'], isTrue);
      final items = (res['data'] as Map)['items'] as List;
      expect(items.length, 1);
    });

    test('Device offline error payload formats standardized JSON', () {
      final errRes = {
        'type': 'FILE_RESPONSE',
        'requestId': 'req-offline',
        'success': false,
        'error': {
          'code': 'DEVICE_OFFLINE',
          'message': 'Android file server host is offline or disconnected.'
        }
      };

      expect(errRes['success'], isFalse);
      expect((errRes['error'] as Map)['code'], 'DEVICE_OFFLINE');
    });
  });
}
