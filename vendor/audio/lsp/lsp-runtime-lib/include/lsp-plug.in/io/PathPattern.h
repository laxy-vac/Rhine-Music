/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 15 окт. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_IO_PATHPATTERN_H_
#define LSP_PLUG_IN_IO_PATHPATTERN_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/lltl/darray.h>

namespace lsp
{
    namespace io
    {
        //
        // The pattern for the file name.
        //
        // Syntax:
        //   *             - Any character sequence except '/' or '\'
        //   ?             - Any character except '/' or '\'
        //   / or \        - Path separator
        //   `/            - Escaped character '/' (Available for escaping: '*', '?', '`', '/', '\', '&', '|', '(', ')' )
        //   name.ext      - Strict match of characters to 'name.ext'
        //   ... & ...     - Conjunction of two conditions
        //   ... | ...     - Disjunction of two conditions
        //   ! ...         - Negotation of match
        //   **/ or **\     - Any path
        //   ( ... )       - Pattern group
        //
        // Example:
        //   **/((*.c|*.h)&(test-*)) - matches any source/header C files for any subdirectory starting with 'test-' prefix
        class PathPattern
        {
            public:
                enum flags
                {
                    INVERSE         = 1 << 0,
                    MATCH_CASE      = 1 << 1,
                    FULL_PATH       = 1 << 2,

                    NONE            = 0
                };

            protected:
                enum command_t
                {
                    CMD_SEQUENCE,       // cmd1 cmd2 ...
                    CMD_AND,            // ... & ...
                    CMD_OR,             // ... | ...
                    CMD_PATTERN,        // ... text ...
                    CMD_ANY,            // ... * ...
                    CMD_ANYPATH,        // ... **/ ...
                };

                enum matcher_type_t
                {
                    M_PATTERN,
                    M_ANY,
                    M_ANYPATH,
                    M_BOOL,
                    M_SEQUENCE,
                    M_BRUTE
                };

                enum token_type_t
                {
                    T_GROUP_START,      // (
                    T_IGROUP_START,     // !(
                    T_GROUP_END,        // )
                    T_OR,               // |
                    T_AND,              // &
                    T_NOT,              // !
                    T_TEXT,             // text
                    T_ANY,              // *
                    T_ANYPATH,          // **/
                    T_EOF               // <eof>
                };

                typedef struct cmd_t
                {
                    command_t               nCommand;   // Command
                    size_t                  nStart;     // Start of character sequence
                    size_t                  nLength;    // Length of character sequence
                    ssize_t                 nChars;     // Actual length in characters (without escaping)
                    bool                    bInverse;   // Inverse condition flag
                    lltl::parray<cmd_t>     sChildren;
                } cmd_t;

                typedef struct tokenizer_t
                {
                    ssize_t                 nToken;

                    const LSPString        *pMask;
                    size_t                  nPosition;
                    size_t                  nStart;     // Start position of token data
                    size_t                  nLength;    // Length of character sequence
                    ssize_t                 nChars;     // Actual length in characters (without escaping)
                } token_t;

            protected:
                struct matcher_t;

                typedef struct pos_t
                {
                    size_t                  start;
                    size_t                  count;
                } pos_t;

                typedef bool        (*match_match_t)(matcher_t *m, size_t start, size_t count);

                typedef struct matcher_t
                {
                    matcher_type_t          type;       // Type of matcher
                    match_match_t           match;

                    const cmd_t            *cmd;        // Command
                    const LSPString        *pat;        // Pattern data
                    const LSPString        *str;        // Destination string to match
                    size_t                  flags;      // Flags
                } matcher_t;

                typedef struct any_matcher_t : public matcher_t
                {
                    ssize_t                 bad;        // Index of last bad character
                    ssize_t                 good;       // Index of last good match
                } any_matcher_t;

                typedef struct bool_matcher_t : public matcher_t
                {
                    lltl::parray<matcher_t> cond;       // List of additionally checked conditions
                } bool_matcher_t;

                typedef struct mregion_t
                {
                    size_t                  start;      // Start of the region
                    matcher_t              *matcher;    // Matcher assigned to the region
                    const cmd_t            *cmd;        // Command
                } mregion_t;

                typedef struct sequence_matcher_t: public matcher_t
                {
                    size_t                  prefix;     // Number of fixed prefixes
                    size_t                  postfix;    // Number of fixed postfixes
                    lltl::darray<mregion_t> fixed;      // Fixed text regions
                    lltl::parray<matcher_t> var;        // Variable text regions
                } sequence_matcher_t;

                typedef struct brute_matcher_t: public matcher_t
                {
                    lltl::darray<mregion_t> items;      // Matching regions
                } brute_matcher_t;

            protected:
                LSPString                   sMask;
                cmd_t                      *pRoot;
                size_t                      nFlags;

            protected:
                status_t                    parse(const LSPString *pattern, size_t flags = NONE);
                bool                        match_full(const LSPString *path) const;

                static ssize_t              get_token(tokenizer_t *it);
                static inline void          next_token(tokenizer_t *it);
                static status_t             parse_not(cmd_t **dst, tokenizer_t *it);
                static status_t             parse_and(cmd_t **dst, tokenizer_t *it);
                static status_t             parse_or(cmd_t **dst, tokenizer_t *it);
                static status_t             parse_sequence(cmd_t **dst, tokenizer_t *it);
                static void                 destroy_cmd(cmd_t *cmd);
                static status_t             merge_simple(cmd_t **out, command_t type, command_t cmd, tokenizer_t *it);
                static status_t             merge_step(cmd_t **out, cmd_t *next, command_t type);
                static status_t             merge_last(cmd_t **dst, cmd_t *out, cmd_t *next, ssize_t tok);

                static matcher_t           *create_matcher(const matcher_t *src, const cmd_t *cmd);
                static bool                 add_range_matcher(sequence_matcher_t *sm, const pos_t *pos);
                static void                 destroy_matcher(matcher_t *match);

                static bool                 pattern_matcher_match(matcher_t *m, size_t start, size_t count);
                static bool                 any_matcher_match(matcher_t *m, size_t start, size_t count);
                static bool                 anypath_matcher_match(matcher_t *m, size_t start, size_t count);
                static bool                 and_matcher_match(matcher_t *m, size_t start, size_t count);
                static bool                 or_matcher_match(matcher_t *m, size_t start, size_t count);
                static bool                 sequence_matcher_match(matcher_t *m, size_t start, size_t count);
                static bool                 brute_matcher_match(matcher_t *m, size_t start, size_t count);

                static bool                 check_pattern_case(const lsp_wchar_t *pat, const lsp_wchar_t *s, size_t len);
                static bool                 check_pattern_nocase(const lsp_wchar_t *pat, const lsp_wchar_t *s, size_t len);
                static ssize_t              seek_pattern_case(const lsp_wchar_t *pat, const lsp_wchar_t *s, size_t len, ssize_t rounds);
                static ssize_t              seek_pattern_nocase(const lsp_wchar_t *pat, const lsp_wchar_t *s, size_t len, ssize_t rounds);

                static ssize_t              sequence_check_prefix(sequence_matcher_t *sm, size_t start, size_t count);
                static ssize_t              sequence_check_postfix(sequence_matcher_t *sm, size_t start, size_t count);
                static bool                 sequence_alloc_fixed(sequence_matcher_t *sm, size_t idx, size_t start, size_t count);
                static bool                 sequence_next_fixed(sequence_matcher_t *sm, size_t start, size_t count);
                static bool                 sequence_match_variable(sequence_matcher_t *sm, size_t start, size_t count);

                static bool                 brute_match_variable(brute_matcher_t *bm, size_t start, size_t count);
                static bool                 brute_next_variable(brute_matcher_t *bm, size_t start, size_t count);

            public:
                explicit PathPattern();
                PathPattern(const PathPattern &) = delete;
                PathPattern(PathPattern &&) = delete;
                ~PathPattern();

                PathPattern & operator = (const PathPattern &) = delete;
                PathPattern & operator = (PathPattern &&) = delete;

            public:
                status_t                    set(const PathPattern *src)                                 { return parse(&src->sMask, src->nFlags);   }
                status_t                    set(const Path *pattern, size_t flags = NONE)               { return parse(pattern->as_string(), flags);}
                status_t                    set(const LSPString *pattern, size_t flags = NONE)          { return parse(pattern, flags);             }
                status_t                    set(const char *pattern, size_t flags = NONE);

                inline const char          *get_utf8() const                                            { return sMask.get_utf8();                  }
                inline const LSPString     *get() const                                                 { return &sMask;                            }
                inline status_t             get(LSPString *mask) const                                  { return (mask != NULL) ? mask->set(&sMask) : STATUS_BAD_ARGUMENTS; }
                inline status_t             get(Path *mask) const                                       { return (mask != NULL) ? mask->set(&sMask) : STATUS_BAD_ARGUMENTS; }

                inline size_t               flags() const                                               { return nFlags;                            }
                size_t                      set_flags(size_t flags);

                inline status_t             set_pattern(const PathPattern *src)                         { return set(&src->sMask, nFlags);          }
                inline status_t             set_pattern(const LSPString *pattern)                       { return set(pattern, nFlags);              }
                inline status_t             set_pattern(const Path *pattern)                            { return set(pattern, nFlags);              }
                inline status_t             set_pattern(const char *pattern)                            { return set(pattern, nFlags);              }

                bool                        test(const char *path) const;
                bool                        test(const LSPString *path) const;
                bool                        test(const Path *path) const;

                void                        swap(PathPattern *dst);
                inline void                 swap(PathPattern &dst)                                      { swap(&dst);                               }
        };
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_PATHPATTERN_H_ */
