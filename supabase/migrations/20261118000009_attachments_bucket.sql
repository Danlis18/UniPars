-- Приватний бакет для вкладень дописів (PDF, DOCX, PPTX, зображення, ZIP), до 25 МБ.
-- Повторний запуск безпечний. Політик для storage.objects немає навмисно:
-- файли завантажує й видає лише backend (service role) після перевірки доступу.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
