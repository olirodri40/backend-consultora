import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:rodriver40@gmail.com',  // ✅ correcto
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export default webpush;