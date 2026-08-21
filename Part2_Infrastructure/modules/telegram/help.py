"""``/help`` and ``/commands`` — prose rendered from the registry, never beside it."""

from __future__ import annotations

from modules.telegram.format import esc, text_card
from modules.telegram.registry import _COMMAND_BY_NAME, COMMAND_SPECS, _category_names


def command_catalogue() -> str:
    lines = ["<b>⌨️ AlphaEngine command catalogue</b>",
             "<code>TEXT + CHARTS + BUTTONS · READ EXCEPT GATED CONTROLS</code>", ""]
    for category in _category_names():
        specs = [spec for spec in COMMAND_SPECS if spec.category == category]
        lines.append(f"<b>{esc(category)}</b>")
        lines.append(" · ".join(f"/{spec.name}" for spec in specs))
        lines.append("")
    lines += [
        "Use <code>/help markets</code> for one category, <code>/help quote</code> for exact syntax, "
        "or <code>/menu</code> for the tappable desks.",
        "<i>No command opens or controls the web UI.</i>",
    ]
    return "\n".join(lines)


def help_text(query: str | None = None) -> str:
    if not query:
        categories = " · ".join(_category_names())
        return text_card(
            "ℹ️ AlphaEngine Companion",
            "TEXT + CHARTS + BUTTONS · INDEPENDENT FROM WEB UI",
            [
                "Read portfolio state, OpenBB market data, execution quality and system health — "
                "as text cards, real-data charts and tappable buttons. <code>/menu</code> opens the desks.",
                "Order submission is intentionally unavailable. The five emergency controls "
                "(/halt, /resume, /flatten, /reduceonly, /resetbook, /replay) need the operator allow-list "
                "and a confirmation code, and are typed, never tapped (only the confirmation is a button).",
                "",
                f"<b>Categories</b>\n{esc(categories)}",
                "",
                "Try <code>/menu</code>, <code>/portfolio</code>, <code>/snapshot AAPL</code>, "
                "<code>/tca BTCUSDT 100000 BUY</code> or <code>/digest</code>.",
            ],
            source="AlphaEngine command registry",
            next_commands="/menu · /commands · /help portfolio · /help quote",
        )

    needle = query.strip().lstrip("/").lower()
    for category in _category_names():
        if needle == category.lower():
            specs = [spec for spec in COMMAND_SPECS if spec.category == category]
            lines = [f"<code>{esc(spec.usage)}</code> — {esc(spec.description.split('·', 1)[-1].strip())}" for spec in specs]
            return text_card(
                f"ℹ️ Help · {category}",
                f"{len(specs)} COMMANDS",
                lines,
                source="AlphaEngine command registry",
                next_commands=f"/help {specs[0].name} · /commands",
            )

    spec = _COMMAND_BY_NAME.get(f"/{needle}")
    if spec:
        aliases = f"\nAliases: {', '.join('/' + alias for alias in spec.aliases)}" if spec.aliases else ""
        return text_card(
            f"ℹ️ Help · /{spec.name}",
            spec.category.upper(),
            [
                esc(spec.description.split("·", 1)[-1].strip()),
                f"Usage   <code>{esc(spec.usage)}</code>",
                f"Example <code>{esc(spec.example)}</code>{esc(aliases)}",
            ],
            source="AlphaEngine command registry",
            next_commands=f"/help {spec.category.lower()} · /commands",
        )
    return text_card(
        "⚠️ Help topic not found",
        "UNKNOWN TOPIC",
        [f"No category or command matches <code>{esc(query)}</code>."],
        source="AlphaEngine command registry",
        next_commands="/commands",
    )


HELP_TEXT = help_text()
