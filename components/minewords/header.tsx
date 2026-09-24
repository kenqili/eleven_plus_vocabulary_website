"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { BookOpen, Menu, UserRound, X } from "lucide-react";
export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <header
      className="topbar"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <Link className="brand" href="/">
        <BookOpen size={25} /> MineWords<span>LEARNING, WORD BY WORD</span>
      </Link>
      <button
        ref={toggle}
        className="header-menu-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="learning-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? (
          <X size={20} aria-hidden="true" />
        ) : (
          <Menu size={20} aria-hidden="true" />
        )}
        {menuOpen ? "Close" : "Menu"}
      </button>
      <nav
        id="learning-navigation"
        className={`header-links${menuOpen ? " is-open" : ""}`}
        aria-label="Your learning"
        onClick={() => setMenuOpen(false)}
      >
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
