import Link from "next/link";
import { BookOpen, UserRound } from "lucide-react";
export default function Header() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <BookOpen size={25} /> MineWords<span>LEARNING, WORD BY WORD</span>
      </Link>
      <nav className="header-links" aria-label="Your learning">
        <Link className="account-link" href="/stories">
          Word Adventures
        </Link>
        <Link className="account-link" href="/words">
          Word list
        </Link>
        <Link className="account-link" href="/calendar">
          Calendar
        </Link>
        <Link className="account-link" href="/about">
          About
        </Link>
        <Link className="account-link" href="/how-to">
          How to use
        </Link>
        <Link className="account-link" href="/rewards">
          Badges
        </Link>
        <Link className="account-link" href="/account">
          <UserRound size={18} /> Your account
        </Link>
      </nav>
    </header>
  );
}
