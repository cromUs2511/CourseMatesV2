// text_normalize.hpp - Unicode-aware, evasion-resistant text folding.
//
// Everything the abuse filter sees passes through here first. The goal is to
// map every way a human can write a word onto ONE canonical byte string, so a
// single Aho-Corasick automaton can catch all of them in one pass.
//
// Two canonical forms are produced:
//   Spaced   - "F.U.C.K off"  -> "f u c k off"   (word boundaries preserved)
//   Squashed - "F.U.C.K off"  -> "fuckof"        (separators + repeats dropped)
//
// Spaced is the default: it keeps word boundaries so "class" never trips a
// rule for "ass". Squashed is opt-in per pattern (`aggressive`) because it is
// deliberately lossy and will produce false positives on short patterns.
//
// No input text is ever retained by this header - it only produces transient
// buffers owned by the caller. That is what keeps the zero-log promise intact.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace cm {

enum class NormMode { Spaced, Squashed };

struct Normalized {
    std::string text;                    // canonical form, alphabet [a-z0-9 ]
    std::vector<std::uint32_t> src;      // text[i] started at original byte src[i]
    std::vector<std::uint32_t> src_end;  // ...and ended just before src_end[i]
};

// Decode one UTF-8 scalar starting at `i`, advancing `i`. Malformed bytes are
// consumed one at a time and reported as U+FFFD so a hostile payload cannot
// stall or over-read the loop.
inline std::uint32_t utf8_next(const std::string& s, std::size_t& i) {
    const std::size_t n = s.size();
    const unsigned char c = static_cast<unsigned char>(s[i]);
    auto cont = [&](std::size_t k) {
        return k < n && (static_cast<unsigned char>(s[k]) & 0xC0u) == 0x80u;
    };
    auto tail = [&](std::size_t k) { return static_cast<std::uint32_t>(static_cast<unsigned char>(s[k]) & 0x3Fu); };

    if (c < 0x80u) { ++i; return c; }
    if ((c & 0xE0u) == 0xC0u && cont(i + 1)) {
        std::uint32_t cp = ((c & 0x1Fu) << 6) | tail(i + 1);
        i += 2;
        return cp;
    }
    if ((c & 0xF0u) == 0xE0u && cont(i + 1) && cont(i + 2)) {
        std::uint32_t cp = ((c & 0x0Fu) << 12) | (tail(i + 1) << 6) | tail(i + 2);
        i += 3;
        return cp;
    }
    if ((c & 0xF8u) == 0xF0u && cont(i + 1) && cont(i + 2) && cont(i + 3)) {
        std::uint32_t cp = ((c & 0x07u) << 18) | (tail(i + 1) << 12) | (tail(i + 2) << 6) | tail(i + 3);
        i += 4;
        return cp;
    }
    ++i;
    return 0xFFFDu;
}

// Fold one scalar to the canonical alphabet.
//   >0  -> that ASCII character ('a'-'z' or '0'-'9')
//    0  -> separator (word break)
//   -1  -> ignorable; drop without breaking the word
inline int fold_cp(std::uint32_t cp) {
    if (cp >= 'A' && cp <= 'Z') return static_cast<int>(cp - 'A' + 'a');
    if (cp >= 'a' && cp <= 'z') return static_cast<int>(cp);

    // Leetspeak. Digits that are not common letter substitutes stay as digits.
    switch (cp) {
        case '0': return 'o';
        case '1': return 'i';
        case '3': return 'e';
        case '4': return 'a';
        case '5': return 's';
        case '7': return 't';
        case '2': case '6': case '8': case '9': return static_cast<int>(cp);
        case '@': return 'a';
        case '$': return 's';
        case '|': return 'i';
        default: break;
    }

    // Invisible characters: dropped WITHOUT a word break, so "f<ZWJ>uck" folds
    // to "fuck" rather than to two separate tokens.
    if (cp == 0x00ADu || cp == 0x034Fu || cp == 0x2060u || cp == 0xFEFFu) return -1;
    if (cp >= 0x200Bu && cp <= 0x200Fu) return -1;
    if (cp >= 0x0300u && cp <= 0x036Fu) return -1;  // combining marks (Zalgo)
    if (cp >= 0x20D0u && cp <= 0x20FFu) return -1;

    // Latin-1 Supplement accents -> base letter.
    if (cp >= 0x00C0u && cp <= 0x00FFu) {
        static const char kLatin1[65] =
            "aaaaaaac" "eeeeiiii" "dnooooo " "ouuuuy s"
            "aaaaaaac" "eeeeiiii" "dnooooo " "ouuuuy y";
        char f = kLatin1[cp - 0x00C0u];
        return f == ' ' ? 0 : f;
    }

    // Homoglyphs actually used for evasion (Cyrillic / Greek look-alikes).
    switch (cp) {
        case 0x0410u: case 0x0430u: return 'a';
        case 0x0412u:               return 'b';
        case 0x0421u: case 0x0441u: return 'c';
        case 0x0415u: case 0x0435u: return 'e';
        case 0x041Du:               return 'h';
        case 0x0406u: case 0x0456u: return 'i';
        case 0x041Au:               return 'k';
        case 0x041Cu:               return 'm';
        case 0x041Eu: case 0x043Eu: return 'o';
        case 0x0420u: case 0x0440u: return 'p';
        case 0x0422u:               return 't';
        case 0x0423u: case 0x0443u: return 'y';
        case 0x0425u: case 0x0445u: return 'x';
        case 0x03B1u:               return 'a';
        case 0x03B5u:               return 'e';
        case 0x03B9u:               return 'i';
        case 0x03BDu:               return 'v';
        case 0x03BFu:               return 'o';
        case 0x03C1u:               return 'p';
        case 0x03C4u:               return 't';
        default: break;
    }

    // Fullwidth forms -> ASCII.
    if (cp >= 0xFF01u && cp <= 0xFF5Eu) return fold_cp(cp - 0xFEE0u);

    // Mathematical alphanumerics (bold/script/fraktur/monospace "aesthetic"
    // text). Each block is exactly 52 slots A-Z then a-z; the digit blocks are
    // 10 slots each.
    if (cp >= 0x1D400u && cp < 0x1D6A4u) {
        std::uint32_t k = (cp - 0x1D400u) % 52u;
        return fold_cp(k < 26u ? ('A' + k) : ('a' + (k - 26u)));
    }
    if (cp >= 0x1D7CEu && cp < 0x1D800u) {
        return fold_cp('0' + ((cp - 0x1D7CEu) % 10u));
    }

    return 0;  // punctuation, emoji, CJK, anything unmapped -> word break
}

inline Normalized normalize(const std::string& in, NormMode mode) {
    Normalized out;
    out.text.reserve(in.size());
    out.src.reserve(in.size());
    out.src_end.reserve(in.size());

    bool pending_sep = false;
    std::size_t i = 0;
    while (i < in.size()) {
        const std::size_t at = i;
        const int f = fold_cp(utf8_next(in, i));
        if (f < 0) continue;
        if (f == 0) { pending_sep = true; continue; }

        const char ch = static_cast<char>(f);
        if (mode == NormMode::Squashed) {
            // Separators vanish and runs collapse, so "fuuuu.ck" == "fuck".
            // Patterns are folded the same way, which keeps "pass" -> "pas"
            // matching on both sides.
            if (!out.text.empty() && out.text.back() == ch) continue;
        } else if (pending_sep && !out.text.empty()) {
            out.text.push_back(' ');
            out.src.push_back(static_cast<std::uint32_t>(at));
            out.src_end.push_back(static_cast<std::uint32_t>(at));
        }
        pending_sep = false;
        out.text.push_back(ch);
        out.src.push_back(static_cast<std::uint32_t>(at));
        out.src_end.push_back(static_cast<std::uint32_t>(i));
    }
    return out;
}

}  // namespace cm
