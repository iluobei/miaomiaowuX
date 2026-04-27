package substore

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var simpleNegativeLookbehindPattern = regexp.MustCompile(`\(\?<\!([^()]*)\)((?:\\.|.))`)
var simpleNegativeLookaheadContainsPattern = regexp.MustCompile(`^\^\(\(\?!([^()]*)\)\.\)\*\$$`)

// normalizeRegexPattern converts some PCRE-style patterns to RE2-compatible forms.
// Currently supported:
//   - (?<!A|B)X  -> (?:^|[^AB])X   (A/B must be single-rune alternatives)
func normalizeRegexPattern(pattern string) string {
	if !strings.Contains(pattern, "(?<!") {
		return pattern
	}

	return simpleNegativeLookbehindPattern.ReplaceAllStringFunc(pattern, func(segment string) string {
		m := simpleNegativeLookbehindPattern.FindStringSubmatch(segment)
		if len(m) != 3 {
			return segment
		}

		charClass, ok := buildCharClassFromAlternatives(m[1])
		if !ok {
			return segment
		}

		return "(?:^|[^" + charClass + "])" + m[2]
	})
}

func buildCharClassFromAlternatives(alts string) (string, bool) {
	parts := strings.Split(alts, "|")
	var classBuilder strings.Builder

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return "", false
		}

		// Support escaped single-rune alternative, e.g. \-
		if strings.HasPrefix(part, `\`) {
			rest := part[1:]
			r, size := utf8.DecodeRuneInString(rest)
			if r == utf8.RuneError || size != len(rest) {
				return "", false
			}
			classBuilder.WriteString(regexp.QuoteMeta(string(r)))
			continue
		}

		r, size := utf8.DecodeRuneInString(part)
		if r == utf8.RuneError || size != len(part) {
			return "", false
		}
		classBuilder.WriteString(regexp.QuoteMeta(string(r)))
	}

	return classBuilder.String(), true
}

func compileCompatibleRegex(pattern string) (*regexp.Regexp, error) {
	return regexp.Compile(normalizeRegexPattern(pattern))
}

func matchCompatibleRegex(pattern, input string) (bool, error) {
	re, err := compileCompatibleRegex(pattern)
	if err != nil {
		return false, err
	}
	return re.MatchString(input), nil
}

// parseSimpleNegativeLookaheadContains extracts literal exclusion terms from:
// ^((?!term1|term2|...).)*$
// Returns false if pattern is not this exact form or contains non-literal terms.
func parseSimpleNegativeLookaheadContains(pattern string) ([]string, bool) {
	m := simpleNegativeLookaheadContainsPattern.FindStringSubmatch(strings.TrimSpace(pattern))
	if len(m) != 2 {
		return nil, false
	}

	parts := strings.Split(m[1], "|")
	if len(parts) == 0 {
		return nil, false
	}

	terms := make([]string, 0, len(parts))
	for _, part := range parts {
		term := strings.TrimSpace(part)
		if term == "" {
			continue
		}
		// Only allow literal terms in this fallback matcher.
		if strings.ContainsAny(term, `\.^$*+?()[]{}|`) {
			return nil, false
		}
		terms = append(terms, term)
	}

	if len(terms) == 0 {
		return nil, false
	}
	return terms, true
}
