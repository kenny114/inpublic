-- Private storage bucket for lecture audio/video uploads, added so Audio
-- Replay's upload doesn't have to fit inside a single serverless function
-- request body. Vercel Functions cap request bodies at 4.5MB; a real
-- lecture recording routinely exceeds that. The browser now uploads
-- directly to this bucket (client-side, under the uploading user's own RLS
-- scope), and app/api/audio/upload/route.ts fetches the object server-side
-- with the service role key, transcribes it, then deletes it — the file is
-- never held any longer than one upload-transcribe cycle, same spirit as
-- the "audio bytes are never persisted server-side" comment that route
-- carried before this bucket existed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lecture-uploads',
  'lecture-uploads',
  false,
  524288000, -- 500MB, matches lib/audio/types.ts's MAX_VIDEO_BYTES
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm',
    'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are named "{user_id}/{uuid}-{filename}" — the first path segment
-- is the RLS scope. Only INSERT is granted to end users: the client uploads
-- and never reads it back (the API route does, via service role, which
-- bypasses RLS entirely), and only the server deletes it after
-- transcription. No SELECT/UPDATE/DELETE policy for authenticated users
-- keeps the bucket write-only from the browser's perspective.
create policy "lecture uploads: users can upload to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'lecture-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);
