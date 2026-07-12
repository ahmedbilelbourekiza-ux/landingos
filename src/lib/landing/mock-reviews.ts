// Mock avatar library + initial reviews data for the Reviews section.
// 6 generated avatar images are cycled to provide 20 picker options —
// mock data only. When real upload lands, this list comes from the media
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

// Initial reviews for the edit workspace. 4 realistic testimonials matching
// the public landing template's mock reviews.
export const mockReviewsData: { reviews: ReviewItem[] } = {
  reviews: [
    {
      id: "rev-1",
      customerName: "Sarah M.",
      rating: 5,
      reviewText:
        "My skin has never looked better. The dark spots on my cheeks faded in two weeks. Worth every penny.",
      avatarUrl: "/avatars/avatar-01.png",
    },
    {
      id: "rev-2",
      customerName: "Yasmine B.",
      rating: 5,
      reviewText:
        "Lightweight, absorbs instantly, no sticky feeling. The dropper gives the perfect amount each time.",
      avatarUrl: "/avatars/avatar-03.png",
    },
    {
      id: "rev-3",
      customerName: "Karim L.",
      rating: 4,
      reviewText:
        "Great serum, genuine results. Delivery was fast and I paid on arrival exactly as promised.",
      avatarUrl: "/avatars/avatar-04.png",
    },
    {
      id: "rev-4",
      customerName: "Nadia E.",
      rating: 5,
      reviewText:
        "Third bottle already. This is the only serum that actually brightened my skin without irritation.",
      avatarUrl: "/avatars/avatar-05.png",
    },
  ],
};
