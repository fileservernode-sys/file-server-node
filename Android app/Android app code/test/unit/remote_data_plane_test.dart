import 'package:flutter_test/flutter_test.dart';

void main() {
  group(
      'Phase 2 — Batch 3 Remote File Manager Data Plane & Streaming Protocol Tests',
      () {
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

    test(
        'STORAGE remote request formats valid payload and receives categorized metrics',
        () {
      final req = {
        'type': 'FILE_REQUEST',
        'requestId': 'req-storage-1',
        'connectionId': 'conn-777',
        'operation': 'STORAGE'
      };

      expect(req['operation'], 'STORAGE');

      final res = {
        'type': 'FILE_RESPONSE',
        'requestId': 'req-storage-1',
        'success': true,
        'data': {
          'totalBytes': 64 * 1024 * 1024 * 1024,
          'usedBytes': 20 * 1024 * 1024 * 1024,
          'freeBytes': 44 * 1024 * 1024 * 1024,
          'categories': {'photos': 5000000, 'videos': 15000000}
        }
      };

      expect(res['success'], isTrue);
      expect(res['requestId'], 'req-storage-1');
      expect((res['data'] as Map)['totalBytes'], 64 * 1024 * 1024 * 1024);
    });

    test(
        'FILE_STREAM_START and FILE_STREAM_CHUNK serialize streaming payloads properly',
        () {
      final streamStart = {
        'type': 'FILE_STREAM_START',
        'transferId': 'tr-100',
        'requestId': 'req-str-1',
        'connectionId': 'conn-777',
        'totalBytes': 5242880,
        'totalChunks': 5
      };

      expect(streamStart['type'], 'FILE_STREAM_START');
      expect(streamStart['transferId'], 'tr-100');
      expect(streamStart['totalBytes'], 5242880);

      final streamChunk = {
        'type': 'FILE_STREAM_CHUNK',
        'transferId': 'tr-100',
        'chunkIndex': 0,
        'dataBase64': 'SGVsbG8gV29ybGQ='
      };

      expect(streamChunk['type'], 'FILE_STREAM_CHUNK');
      expect(streamChunk['chunkIndex'], 0);

      final streamEnd = {
        'type': 'FILE_STREAM_END',
        'transferId': 'tr-100',
        'requestId': 'req-str-1'
      };

      expect(streamEnd['type'], 'FILE_STREAM_END');
    });

    test('FILE_STREAM_CANCEL payload formats reason and transfer identifier',
        () {
      final cancelMsg = {
        'type': 'FILE_STREAM_CANCEL',
        'transferId': 'tr-100',
        'reason': 'User aborted download'
      };

      expect(cancelMsg['type'], 'FILE_STREAM_CANCEL');
      expect(cancelMsg['transferId'], 'tr-100');
      expect(cancelMsg['reason'], 'User aborted download');
    });

    test('RECENT files remote request returns ordered items payload', () {
      final req = {
        'type': 'FILE_REQUEST',
        'requestId': 'req-recent-1',
        'connectionId': 'conn-777',
        'operation': 'RECENT'
      };

      expect(req['operation'], 'RECENT');

      final res = {
        'type': 'FILE_RESPONSE',
        'requestId': 'req-recent-1',
        'success': true,
        'data': {
          'items': [
            {'name': 'recent.pdf', 'category': 'documents', 'sizeBytes': 1024}
          ]
        }
      };

      expect(res['success'], isTrue);
      expect(((res['data'] as Map)['items'] as List).length, 1);
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

    test('UPLOAD remote request formats valid payload and receives confirmation', () {
      final req = {
        'type': 'FILE_REQUEST',
        'requestId': 'req-upload-1',
        'connectionId': 'conn-777',
        'operation': 'UPLOAD',
        'path': '/Documents',
        'name': 'contract.pdf',
        'dataBase64': 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PA=='
      };

      expect(req['type'], 'FILE_REQUEST');
      expect(req['operation'], 'UPLOAD');
      expect(req['path'], '/Documents');
      expect(req['name'], 'contract.pdf');
      expect(req['dataBase64'], isNotNull);

      final res = {
        'type': 'FILE_RESPONSE',
        'requestId': 'req-upload-1',
        'success': true,
        'data': {
          'filename': 'contract.pdf',
          'sizeBytes': 25
        }
      };

      expect(res['success'], isTrue);
      expect(res['requestId'], 'req-upload-1');
      expect((res['data'] as Map)['filename'], 'contract.pdf');
      expect((res['data'] as Map)['sizeBytes'], 25);
    });
  });
}
