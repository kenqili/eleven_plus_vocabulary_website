"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Menu,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import ThemePicker from "./theme-picker";

/**
 * Four things a child came for, a disclosure for the rest, and one link that is
 * deliberately neither.
 *
 * There were eleven equal links, and a review of this app as a nine-year-old
 * found the wrong ones in it: the guides open with an article about exam
 * pressure and its effect on mental health, and the page headed "Guides for
 * parents". One tap from a question about what a word means. Ten links is also
 * a lot of decisions before the first word.
 *
 * The 11+ page used to be one of those ten links, as an index of articles. It
 * is now a single page, which is what a parent arriving cold actually wants.
 *
 * "Your account" sat inside the grown-ups panel, which put the thing that panel
 * exists for behind the thing it was hiding. Reading the privacy notice is
 * optional. Signing in, cancelling a subscription or deleting an account is
 * not, and nobody arrives looking for it by browsing. So it sits outside the
 * disclosure, next to the four links, and costs one more word on an already
 * full row.
 */
const FOR_CHILDREN = [
  { href: "/stories", label: "Word Adventures" },
  { href: "/words", label: "Word list" },
  { href: "/rewards", label: "Badges" },
  { href: "/calendar", label: "Calendar" },
];

const FOR_GROWN_UPS = [
  { href: "/how-to", label: "How to use this" },
  { href: "/info", label: "The 11+ explained" },
  { href: "/words/manage", label: "Choose which words to practise" },
  { href: "/words/print", label: "Printable word sheets" },
  { href: "/about", label: "About MineWords" },
  { href: "/privacy", label: "What we store, and how to delete it" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [grownUpsOpen, setGrownUpsOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <BookOpen size={22} aria-hidden />
        <span>MineWords</span>
      </Link>
      <button
        className="header-menu-toggle"
        ref={toggle}
        aria-expanded={menuOpen}
        aria-controls="learning-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        {menuOpen ? "Close" : "Menu"}
      </button>
      <nav
        id="learning-navigation"
        className={`header-links${menuOpen ? " is-open" : ""}`}
        aria-label="Your learning"
        onClick={() => setMenuOpen(false)}
      >
        {FOR_CHILDREN.map((link) => (
          <Link key={link.href} className="account-link" href={link.href}>
            {link.label}
          </Link>
        ))}
        <Link className="account-link" href="/account">
          <UserRound size={17} aria-hidden /> Your account
        </Link>
        <div
          className={`grown-ups${grownUpsOpen ? " is-open" : ""}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="account-link grown-ups-toggle"
            aria-expanded={grownUpsOpen}
            onClick={() => setGrownUpsOpen((open) => !open)}
          >
            <ShieldCheck size={17} aria-hidden /> Grown-ups
            <ChevronDown size={15} aria-hidden className="grown-ups-chevron" />
          </button>
          {grownUpsOpen ? (
            <div className="grown-ups-menu">
              <p>
                These pages are written for the grown-up helping. Some of them
                talk about exam pressure.
              </p>
              {FOR_GROWN_UPS.map((link) => (
                <Link key={link.href} className="account-link" href={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </nav>
      <div className="header-tools">
        <ThemePicker />
      </div>
    </header>
  );
}
