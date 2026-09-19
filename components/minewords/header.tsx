import { BookOpen, UserRound } from "lucide-react";
export default function Header() {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <BookOpen size={25} /> MineWords<span>LEARNING, WORD BY WORD</span>
      </a>
      <a className="account-link" href="/account">
        <UserRound size={18} /> Your account
      </a>
    </header>
  );
}
