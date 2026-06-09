interface ShareBannerProps {
  onShare: () => void;
}

export default function ShareBanner({ onShare }: ShareBannerProps) {
  return (
    <button type="button" className="tg-share-button" onClick={onShare}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M10 4.5a2 2 0 1 0-1.9-2.6L5.4 3.5M4 7a2 2 0 1 0 0 .1zM10 12a2 2 0 1 0-1.9-2.6L5.4 8" />
      </svg>
      Share graph
    </button>
  );
}
