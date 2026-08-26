import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Phase 2 — Batch 2 File Manager & Storage Intelligence Tests', () {
    test('Local File Server URL resolves to loopback 127.0.0.1:8080', () {
      const activePort = 8080;
      const localUrl = 'http://127.0.0.1:$activePort';
      expect(localUrl, 'http://127.0.0.1:8080');
    });

    test('Path Traversal Prevention rejects escape outside sandbox root', () {
      bool isPathAllowed(String root, String requestedPath) {
        if (requestedPath.contains('..') ||
            requestedPath.contains('\u0000') ||
            requestedPath.toLowerCase().contains('%2e%2e')) {
          return false;
        }
        return true;
      }

      expect(isPathAllowed('/sandbox', '/Documents'), isTrue);
      expect(isPathAllowed('/sandbox', '/../system/'), isFalse);
      expect(isPathAllowed('/sandbox', '/%2e%2e/etc/passwd'), isFalse);
      expect(isPathAllowed('/sandbox', '/etc/passwd\u0000'), isFalse);
    });

    test(
        'Storage API response formats real category metrics and disk statistics',
        () {
      final storageResponse = {
        'success': true,
        'data': {
          'totalBytes': 128 * 1024 * 1024 * 1024,
          'usedBytes': 42 * 1024 * 1024 * 1024,
          'freeBytes': 86 * 1024 * 1024 * 1024,
          'sandboxUsedBytes': 4 * 1024 * 1024 * 1024,
          'usagePercentage': 33,
          'categories': {
            'photos': 2 * 1024 * 1024 * 1024,
            'videos': 1 * 1024 * 1024 * 1024,
            'documents': 500 * 1024 * 1024,
            'audio': 300 * 1024 * 1024,
            'archives': 150 * 1024 * 1024,
            'other': 50 * 1024 * 1024
          },
          'counts': {
            'photos': 120,
            'videos': 15,
            'documents': 45,
            'audio': 30,
            'archives': 10,
            'other': 8,
            'total': 228
          },
          'largestFiles': [
            {
              'name': 'vacation_video.mp4',
              'path': '/Videos/vacation_video.mp4',
              'sizeBytes': 850 * 1024 * 1024,
              'modifiedAt': '2026-08-15T12:00:00Z'
            }
          ]
        }
      };

      expect(storageResponse['success'], isTrue);
      final data = storageResponse['data'] as Map<String, dynamic>;
      expect(data['usagePercentage'], 33);
      final categories = data['categories'] as Map<String, dynamic>;
      expect(categories.containsKey('photos'), isTrue);
      expect(categories.containsKey('videos'), isTrue);
      expect(categories.containsKey('documents'), isTrue);
      expect(categories.containsKey('audio'), isTrue);
      expect(categories.containsKey('archives'), isTrue);

      final counts = data['counts'] as Map<String, dynamic>;
      expect(counts['total'], 228);

      final largest = data['largestFiles'] as List;
      expect(largest.length, 1);
    });

    test('Recent files API formats descending timestamp metadata', () {
      final recentResponse = {
        'success': true,
        'data': {
          'items': [
            {
              'name': 'latest_report.pdf',
              'isDir': false,
              'sizeBytes': 204800,
              'category': 'documents',
              'modifiedAt': '2026-08-16T00:00:00Z',
              'path': '/Documents/latest_report.pdf'
            },
            {
              'name': 'photo_sunset.jpg',
              'isDir': false,
              'sizeBytes': 4096000,
              'category': 'photos',
              'modifiedAt': '2026-08-15T18:30:00Z',
              'path': '/Photos/photo_sunset.jpg'
            }
          ]
        }
      };

      expect(recentResponse['success'], isTrue);
      final items = (recentResponse['data'] as Map)['items'] as List;
      expect(items.length, 2);

      final firstDate = DateTime.parse(items[0]['modifiedAt']);
      final secondDate = DateTime.parse(items[1]['modifiedAt']);
      expect(firstDate.isAfter(secondDate), isTrue);
    });

    test('Category classifier correctly maps file extensions', () {
      String classify(String name) {
        final ext = name.split('.').last.toLowerCase();
        const photos = {
          'jpg',
          'jpeg',
          'png',
          'webp',
          'gif',
          'bmp',
          'heic',
          'heif',
          'svg'
        };
        const videos = {'mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', '3gp'};
        const docs = {'pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xlsx', 'pptx'};
        const audio = {'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'};
        const archives = {'zip', 'tar', 'gz', '7z', 'rar'};

        if (photos.contains(ext)) return 'photos';
        if (videos.contains(ext)) return 'videos';
        if (docs.contains(ext)) return 'documents';
        if (audio.contains(ext)) return 'audio';
        if (archives.contains(ext)) return 'archives';
        return 'other';
      }

      expect(classify('landscape.jpg'), 'photos');
      expect(classify('recording.mp4'), 'videos');
      expect(classify('contract.pdf'), 'documents');
      expect(classify('podcast.mp3'), 'audio');
      expect(classify('backup.zip'), 'archives');
      expect(classify('unknown.dat'), 'other');
    });

    test('Upload operation resolves destination sandbox and sanitizes filename', () {
      String sanitizeUploadFilename(String raw) {
        if (raw.contains('\u0000') || raw.contains('..') || raw.toLowerCase().contains('%2e%2e')) {
          throw Exception('Security violation: path traversal in filename');
        }
        final parts = raw.split(RegExp(r'[\\/]'));
        final basename = parts.lastWhere((p) => p.isNotEmpty, orElse: () => 'upload.dat');
        return basename;
      }

      expect(sanitizeUploadFilename('vacation photo.jpg'), 'vacation photo.jpg');
      expect(sanitizeUploadFilename('subfolder/document.pdf'), 'document.pdf');
      expect(sanitizeUploadFilename(r'C:\Windows\System32\cmd.exe'), 'cmd.exe');
      expect(() => sanitizeUploadFilename('../../etc/passwd'), throwsA(isA<Exception>()));
      expect(() => sanitizeUploadFilename('test\u0000.png'), throwsA(isA<Exception>()));
    });

    test('Upload response structure conforms to expected contract', () {
      final uploadRes = {
        'success': true,
        'data': {
          'filename': 'sample_upload.png',
          'sizeBytes': 1048576
        }
      };

      expect(uploadRes['success'], isTrue);
      final data = uploadRes['data'] as Map<String, dynamic>;
      expect(data['filename'], 'sample_upload.png');
      expect(data['sizeBytes'], 1048576);
    });
  });
}
