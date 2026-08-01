// Review item type + avatar picker options for the Reviews section editor.
// The avatar list is generated from 6 base images cycled to provide 20
// picker options. When real upload lands, this list can come from the media
// library or a dedicated avatars table.

export interface ReviewItem {
  id: string;
  customerName: string;
  rating: number; // 1–5
  reviewText: string;
  avatarUrl: string | null;
}

// 20 avatar options for the picker. The 6 generated images cycle with
// numbered labels so each option has a unique id.
const AVATAR_FILES = [
  "/avatars/avatar-01.png",
  "/avatars/avatar-02.png",
  "/avatars/avatar-03.png",
  "/avatars/avatar-04.png",
  "/avatars/avatar-05.png",
  "/avatars/avatar-06.png",
];

export const mockAvatarOptions: { id: string; url: string; label: string }[] =
  Array.from({ length: 20 }, (_, i) => ({
    id: `avatar-opt-${i + 1}`,
    url: AVATAR_FILES[i % AVATAR_FILES.length],
    label: `Avatar ${i + 1}`,
  }));
