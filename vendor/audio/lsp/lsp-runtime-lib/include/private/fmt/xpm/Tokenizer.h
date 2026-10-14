/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 янв. 2026 г.
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

#ifndef PRIVATE_FMT_XPM_TOKENIZER_H_
#define PRIVATE_FMT_XPM_TOKENIZER_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/common/alloc.h>
#include <lsp-plug.in/stdlib/string.h>

#include <private/fmt/xpm/utils.h>

namespace lsp
{
    namespace xpm
    {
        enum token_type_t
        {
            TOK_INVALID,
            TOK_DEFINE,
            TOK_XPM2_SIG,
            TOK_XPM3_SIG,
            TOK_STRING,
            TOK_ASTERISK,
            TOK_LBRACE,
            TOK_RBRACE,
            TOK_LQBRACKET,
            TOK_RQBRACKET,
            TOK_SEMICOLON,
            TOK_COMMA,
            TOK_ASSIGN,
            TOK_IDENTIFIER,
            TOK_INTEGER,
            TOK_COMMENT,
        };

        /**
         * Parser for XPM1 built-in format
         */
        class LSP_HIDDEN_MODIFIER Tokenizer
        {
            private:
                static constexpr size_t BUF_SIZE    = 0x400;

            private:
                typedef struct token_t
                {
                    token_type_t    type;
                    char           *value;
                    size_t          length;
                    size_t          capacity;
                    bool            unread;
                } token_t;

            private:
                io::IInStream  *pIS;
                size_t          nWFlags;
                char           *pBuffer;
                int             nLastChar;
                size_t          nSize;
                size_t          nOffset;
                token_t         sToken;
                size_t          nLineNum;
                bool            bNewLine;

            private:
                bool            append(char ch)
                {
                    if (sToken.length >= sToken.capacity)
                    {
                        const size_t new_cap = lsp_max(sToken.capacity + (sToken.capacity >> 1), size_t(0x20));
                        char *ptr            = static_cast<char *>(realloc(sToken.value, new_cap));
                        if (ptr == NULL)
                            return false;

                        sToken.value        = ptr;
                        sToken.capacity     = new_cap;
                    }

                    sToken.value[sToken.length++] = ch;
                    return true;
                }

                inline int      getch()
                {
                    // Is there a character in unget buffer?
                    const int ch    = nLastChar;
                    if (ch >= 0)
                    {
                        nLastChar = -1;
                        return ch;
                    }

                    // Is buffer not empty?
                    if (nOffset >= nSize)
                    {
                        // Read data
                        const ssize_t nread = pIS->read(pBuffer, BUF_SIZE);
                        if (nread < 0)
                            return int(nread);

                        nOffset     = 0;
                        nSize       = nread;
                    }

                    return (nOffset < nSize) ? pBuffer[nOffset++] : -STATUS_EOF;
                }

                inline void     ungetch(char ch)
                {
                    nLastChar       = ch;
                }

                status_t        skip_whitespace()
                {
                    int ch;
                    while ((ch = getch()) >= 0)
                    {
                        if (!is_space(ch))
                        {
                            ungetch(ch);
                            return STATUS_OK;
                        }
                        if (ch == '\n')
                        {
                            ++nLineNum;
                            bNewLine = true;
                        }
                    }

                    return (ch == -STATUS_EOF) ? STATUS_OK : status_t(-ch);
                }

                status_t        read_alphadigit(size_t nread)
                {
                    int ch;

                    while ((ch = getch()) >= 0)
                    {
                        if (!is_alphadigit(ch))
                        {
                            ungetch(ch);
                            if (nread <= 0)
                                return STATUS_CORRUPTED_FILE;
                            return (nread > 0) ? STATUS_OK : STATUS_CORRUPTED_FILE;
                        }

                        if (!append(ch))
                            return STATUS_NO_MEM;
                    }

                    return (nread > 0) ? STATUS_OK : status_t(-ch);
                }

                status_t        read_identifier()
                {
                    // Read first character
                    int ch = getch();
                    if (ch <= 0)
                        return status_t(-ch);
                    if (!is_alpha(ch))
                        return STATUS_CORRUPTED_FILE;
                    if (!append(ch))
                        return STATUS_NO_MEM;

                    status_t res = read_alphadigit(1);
                    return (res == STATUS_EOF) ? STATUS_OK : res;
                }

                status_t        read_integer(size_t nread)
                {
                    int ch;

                    while ((ch = getch()) >= 0)
                    {
                        if (!is_digit(ch))
                        {
                            ungetch(ch);
                            return (nread > 0) ? STATUS_OK : STATUS_CORRUPTED_FILE;
                        }

                        if (!append(ch))
                            return STATUS_NO_MEM;
                    }

                    return (nread > 0) ? STATUS_OK : status_t(-ch);
                }

                status_t        expect_characters(const char *text)
                {
                    // Match characters
                    int ch;
                    for ( ; *text != '\0'; ++text)
                    {
                        if ((ch = getch()) < 0)
                            return ch;
                        if (ch != (*text))
                            return STATUS_CORRUPTED_FILE;
                        if (!append(ch))
                            return STATUS_NO_MEM;
                    }

                    return STATUS_OK;
                }

                status_t        expect_end_of_line()
                {
                    int ch;

                    // Complete read until the end-of-line
                    while ((ch = getch()) >= 0)
                    {
                        switch (ch)
                        {
                            case '\n': // End of line
                                ++nLineNum;
                                bNewLine = true;
                                return STATUS_OK;

                            case '\r': // \r\n sequence
                                if ((ch = getch()) < 0)
                                    return ch;
                                if (ch != '\n')
                                    return STATUS_CORRUPTED_FILE;

                                ++nLineNum;
                                bNewLine = true;
                                return STATUS_OK;

                            default: // Only space characters allowed
                                if (!is_space(ch))
                                    return STATUS_CORRUPTED_FILE;
                                break;
                        }
                    }
                    return ch;
                }

                status_t        expect_signature(const char *text)
                {
                    status_t res = expect_characters(text);
                    if (res == STATUS_OK)
                        res = expect_end_of_line();
                    return res;
                }

                status_t        read_comment()
                {
                    int ch;
                    while ((ch = getch()) >= 0)
                    {
                        if (!append(ch))
                            return STATUS_NO_MEM;

                        if (ch == '*') // Possible end of comment?
                        {
                            if ((ch = getch()) < 0)
                                return status_t(-ch);

                            if (!append(ch))
                                return STATUS_NO_MEM;

                            if (ch == '/')
                                return STATUS_OK;
                        }

                    }

                    return status_t(-ch);
                }

                status_t read_c_string()
                {
                    int ch;
                    while ((ch = getch()) >= 0)
                    {
                        if (ch == '\"') // End of string found
                            return STATUS_OK;
                        else if (ch == '\\') // We do not allow any escape sequences in strings
                            return STATUS_CORRUPTED_FILE;

                        if (!append(ch))
                            return STATUS_NO_MEM;
                    }

                    return status_t(-ch);
                }

            public:
                Tokenizer(io::IInStream *is, size_t flags)
                {
                    pIS             = is;
                    nWFlags         = flags;
                    pBuffer         = NULL;
                    nLastChar       = -1;
                    nSize           = 0;
                    nOffset         = 0;

                    sToken.type     = TOK_INVALID;
                    sToken.value    = NULL;
                    sToken.length   = 0;
                    sToken.capacity = 0;
                    sToken.unread   = false;
                    nLineNum        = 0;

                    bNewLine        = true;
                }

                ~Tokenizer()
                {
                    close();
                }

            public:
                status_t init(size_t prefetch = 0x20)
                {
                    // Allocate buffer
                    pBuffer     = static_cast<char *>(malloc(BUF_SIZE));
                    if (pBuffer == NULL)
                        return STATUS_NO_MEM;
                    nOffset     = 0;
                    nSize       = 0;
                    nLineNum    = 0;
                    nLastChar   = -1;
                    bNewLine    = true;

                    // Prefetch data
                    const size_t to_read    = lsp_min(prefetch, BUF_SIZE);
                    if (to_read <= 0)
                        return STATUS_OK;

                    const ssize_t nread     = pIS->read(pBuffer, to_read);
                    if (nread < 0)
                        return -status_t(nread);

                    nSize                   = nread;
                    return STATUS_OK;
                }

                status_t close()
                {
                    // Drop buffer
                    if (pBuffer != NULL)
                    {
                        free(pBuffer);
                        pBuffer     = NULL;
                    }

                    // Drop token buffer
                    if (sToken.value != NULL)
                    {
                        free(sToken.value);
                        sToken.value    = NULL;
                    }

                    if (pIS == NULL)
                        return STATUS_OK;

                    status_t res        = pIS->close();
                    if (nWFlags & WRAP_CLOSE)
                        res     = update_status(res, pIS->close());
                    if (nWFlags & WRAP_DELETE)
                        delete pIS;

                    pIS         = NULL;

                    return res;
                }

                status_t read_token(token_type_t & type, const char * & value)
                {
                    if (sToken.unread)
                    {
                        type            = sToken.type;
                        value           = sToken.value;
                        sToken.unread   = false;
                        return STATUS_OK;
                    }

                    sToken.type     = TOK_INVALID;
                    sToken.length   = 0;

                    int ch          = getch();
                    if (ch < 0)
                        return status_t(-ch);

                    if (!append(ch))
                        return STATUS_NO_MEM;

                    status_t res;
                    switch (ch)
                    {
                        case '*':   // Asterisk
                            sToken.type         = TOK_ASTERISK;
                            break;
                        case '{':   // Left brace
                            sToken.type         = TOK_LBRACE;
                            break;
                        case '}':   // Right brace
                            sToken.type         = TOK_RBRACE;
                            break;
                        case '[':   // Left square bracket
                            sToken.type         = TOK_LQBRACKET;
                            break;
                        case ']':   // Right square bracket
                            sToken.type         = TOK_RQBRACKET;
                            break;
                        case ';':   // Semicolon
                            sToken.type         = TOK_SEMICOLON;
                            break;
                        case ',':   // Comma
                            sToken.type         = TOK_COMMA;
                            break;
                        case '=':   // Assign
                            sToken.type         = TOK_ASSIGN;
                            break;
                        case '#':   // define
                            if (!bNewLine)
                                return STATUS_CORRUPTED_FILE;
                            if ((res = read_identifier()) != STATUS_OK)
                                return res;
                            if (memcmp(sToken.value, "#define", sToken.length) != 0)
                                return STATUS_CORRUPTED_FILE;
                            sToken.type         = TOK_DEFINE;
                            break;
                        case '!':   // XPM2 header
                            if (nLineNum != 0)
                                return STATUS_CORRUPTED_FILE;
                            if ((res = expect_signature(" XPM2")) != STATUS_OK)
                                return res;
                            sToken.type         = TOK_XPM2_SIG;
                            break;
                        case '/':   // XPM3 signature?
                            if ((res = expect_characters("* XPM")) == STATUS_OK)
                            {
                                if (nLineNum != 0)
                                    return STATUS_CORRUPTED_FILE;

                                ch    = getch();
                                if (ch < 0)
                                    return status_t(-ch);
                                if (ch == '3')
                                {
                                    if (!append(ch))
                                        return STATUS_NO_MEM;
                                    if ((res = expect_signature(" */")) != STATUS_OK)
                                        return res;
                                }
                                else if (ch == ' ')
                                {
                                    if ((res = expect_signature("*/")) != STATUS_OK)
                                        return res;
                                }
                                sToken.type         = TOK_XPM3_SIG;
                            }
                            else
                            {
                                if ((res = read_comment()) != STATUS_OK)
                                    return res;
                                if ((res = expect_end_of_line()) != STATUS_OK)
                                    return res;
                                sToken.type         = TOK_COMMENT;
                            }

                            break;
                        case '\"':  // C String
                            --sToken.length;    // Remove '"' character
                            if ((res = read_c_string()) != STATUS_OK)
                                return res;
                            sToken.type         = TOK_STRING;
                            break;

                        default:    // Integer, identifier
                            if (is_alpha(ch))
                            {
                                sToken.type         = TOK_IDENTIFIER;
                                res = read_alphadigit(1);
                            }
                            else if (is_digit(ch))
                            {
                                sToken.type         = TOK_INTEGER;
                                res = read_integer(1);
                            }
                            else
                                return STATUS_CORRUPTED_FILE;

                            if ((res != STATUS_OK) && (res != STATUS_EOF))
                                return res;
                            break;
                    }

                    // Append terminating zero character
                    if (!append('\0'))
                        return STATUS_NO_MEM;

                    bNewLine    = false;
                    if ((res = skip_whitespace()) != STATUS_OK)
                        return res;

                    type        = sToken.type;
                    value       = sToken.value;

                    return STATUS_OK;
                }

                void unread_token()
                {
                    sToken.unread       = true;
                }

                status_t read_line(const char * & value)
                {
                    sToken.length   = 0;

                    // Read file until we find the '\n' character
                    int ch;
                    while ((ch = getch()) >= 0)
                    {
                        if (ch == '\n')
                        {
                            bNewLine = true;
                            ++nLineNum;
                            break;
                        }
                        if (!append(ch))
                            return STATUS_NO_MEM;
                    }

                    // Analyze status
                    if (ch < 0)
                    {
                        // Check that we reached end of file
                        if (ch != -STATUS_EOF)
                            return status_t(-ch);
                        if (sToken.length <= 0)
                            return STATUS_EOF;
                    }
                    else
                    {
                        // Remove trailing '\r' character if present
                        if ((sToken.length > 0) && (sToken.value[sToken.length - 1] == '\r'))
                            --sToken.length;
                    }

                    // Append terminating zero character
                    if (!append('\0'))
                        return STATUS_NO_MEM;

                    value       = sToken.value;

                    return STATUS_OK;
                }
        };

    } /* namespace xpm */
} /* namespace lsp */



#endif /* PRIVATE_FMT_XPM_TOKENIZER_H_ */
