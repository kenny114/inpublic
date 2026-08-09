/**
 * Line icons for the dashboard chrome.
 *
 * Deliberately plain: 24-box, 1.5 stroke, round caps, `currentColor`. They sit
 * next to navigation labels and should read as quiet structure, not decoration.
 * (lib/icons.ts is a different thing entirely — those are drawn onto the
 * canvas by the Scribe.)
 */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const icon = (path: React.ReactNode) =>
  function Icon({ className = "h-4 w-4" }: IconProps) {
    return <svg {...base} className={className}>{path}</svg>;
  };

export const HomeIcon = icon(<><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" /></>);
export const SessionsIcon = icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M9 9.5V19.5" /></>);
export const RecordingsIcon = icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>);
export const VocabularyIcon = icon(<><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>);
export const ExportsIcon = icon(<><path d="M12 15V4" /><path d="m8.5 7.5 3.5-3.5 3.5 3.5" /><path d="M4.5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V14" /></>);
export const SettingsIcon = icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" /></>);
export const HelpIcon = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.5a2.2 2.2 0 1 1 2.9 2.1c-.5.2-.7.6-.7 1.1v.6" /><path d="M12 16.4h.01" /></>);
export const SearchIcon = icon(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
export const PlusIcon = icon(<><path d="M12 5v14M5 12h14" /></>);
export const MenuIcon = icon(<><path d="M4 7h16M4 12h16M4 17h16" /></>);
export const CloseIcon = icon(<><path d="m6 6 12 12M18 6 6 18" /></>);
export const MoreIcon = icon(<><circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" /></>);
export const StarIcon = icon(<><path d="m12 4 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z" /></>);
