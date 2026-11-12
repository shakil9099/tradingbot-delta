/** Generic diamond mark used in the header and on the login page. */
export default function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2 4 12l8 4.5L20 12 12 2Z" fill="#fff" fillOpacity=".95" />
        <path d="m4 13.6 8 8.4 8-8.4-8 4.5-8-4.5Z" fill="#fff" fillOpacity=".6" />
      </svg>
    </span>
  );
}
