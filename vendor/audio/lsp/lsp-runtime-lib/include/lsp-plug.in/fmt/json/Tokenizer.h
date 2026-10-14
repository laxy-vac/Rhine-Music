/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 окт. 2019 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_TOKENIZER_H_
#define LSP_PLUG_IN_FMT_JSON_TOKENIZER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/fmt/json/token.h>

namespace lsp
{
    namespace json
    {
        
        class Tokenizer
        {
            private:
                friend class Serializer;

            protected:
                io::IInSequence        *pIn;
                lsp_swchar_t            cCurrent;
                token_t                 enToken;
                LSPString               sValue;
                union
                {
                    double              fValue;
                    ssize_t             iValue;
                };
                status_t                nError;
                size_t                  nUnget;
                lsp_utf16_t            *vPending;
                size_t                  nPending;
                size_t                  nCapacity;

            protected:
                lsp_swchar_t        skip_whitespace();
                inline lsp_swchar_t lookup();
                token_t             commit(token_t token);
                inline token_t      skip(token_t token)            { cCurrent = -1; return enToken = token; }
                lsp_swchar_t        commit_lookup(token_t token);
                inline token_t      set_error(status_t code);

                static bool         is_reserved_word(const LSPString *text);
                static bool         is_valid_identifier(const LSPString *text);
                static bool         is_identifier_start(lsp_wchar_t ch);
                static bool         is_identifier(lsp_wchar_t ch);
                static bool         parse_digit(int *digit, lsp_wchar_t ch, int radix);

                status_t            add_pending_character(lsp_utf16_t ch);
                status_t            commit_pending_characters();
                token_t             parse_unicode_escape_sequence(token_t type);
                token_t             parse_hexadecimal_escape_sequence(token_t type);

                token_t             parse_string(token_t type);
                token_t             parse_identifier();
                token_t             parse_single_line_comment();
                token_t             parse_multiline_comment();
                token_t             parse_number();

            public:
                explicit Tokenizer(io::IInSequence *in);
                Tokenizer(const Tokenizer &) = delete;
                Tokenizer(Tokenizer &&) = delete;
                virtual ~Tokenizer();

                Tokenizer & operator = (const Tokenizer &) = delete;
                Tokenizer & operator = (Tokenizer &&) = delete;

            public:
                /**
                 * Get token
                 * @param get force token lookup
                 * @return current token value
                 */
                token_t                 get_token(bool get);

                /**
                 * Unget token
                 */
                inline void             unget()     { ++nUnget; };

                /**
                 * Get current token
                 * @return current token
                 */
                inline token_t          current() const { return enToken; }

                /**
                 * Get current token value for tokens that consist of characters
                 * @return current token value
                 */
                inline const LSPString *text_value() const  { return &sValue; }

                /**
                 * Get floating-point value of the token
                 * @return floating-point value of the token
                 */
                inline const double     float_value() const { return fValue; }

                /**
                 * Get integer value of the token
                 * @return integer value of the token
                 */
                inline ssize_t          int_value() const   { return iValue; }

                /**
                 * Get last error code
                 * @return last error code
                 */
                inline status_t         error() const { return nError; }
        };
    
    } /* namespace json */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_JSON_TOKENIZER_H_ */
