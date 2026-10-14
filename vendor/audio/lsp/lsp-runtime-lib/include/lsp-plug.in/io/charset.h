/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 18 июн. 2018 г.
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

#ifndef LSP_PLUG_IN_IO_CHARSET_H_
#define LSP_PLUG_IN_IO_CHARSET_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/stdlib/string.h>

#if defined(PLATFORM_WINDOWS)
#else
    #include <iconv.h>
    #include <locale.h>
#endif /* PLATFORM_WINDOWS */

#define LSP_UTF32_EOF       lsp_utf32_t(-1)

namespace lsp
{
#if defined(PLATFORM_WINDOWS)
    typedef uint32_t        LCID;

    ssize_t                 get_codepage(LCID locale, bool ansi = true);

    ssize_t                 codepage_from_name(const char *charset);

    /**
     * This is a MultiByteToWideChar wrapping function that handles additional cases
     * for non-MBCS encodings
     *
     * @param cp code page
     * @param src source buffer
     * @param nsrc number of bytes available in source buffer (will be updated on exit)
     * @param dst destination buffer (can be NULL for just estimating the length)
     * @param ndst number of characters in destination buffer (will be updated on exit,
     *        can be NULL or point to zero value for just estimating the length)
     * @return number of UTF-16 characters written to destination buffer or negative error code
     */
    ssize_t                 multibyte_to_widechar(size_t cp, const char *src, size_t *nsrc, lsp_utf16_t *dst, size_t *ndst);

    /**
     * This is a WideCharToMultiByte wrapping function that handles additional cases
     * for non-MBCS encodings
     *
     * @param cp code page
     * @param src source wide string to perform encoding
     * @param nsrc number of characters available in source wide string (will be updated on exit)
     * @param dst target string to perform encoding (can be NULL for just estimating the length)
     * @param ndst number of bytes in destination buffer (will be updated on exit,
     *        can be NULL or point to zero value for just estimating the length)
     * @return number of bytes written to destination buffer or negative error code
     */
    ssize_t                 widechar_to_multibyte(size_t cp, const lsp_utf16_t *src, size_t *nsrc, char *dst, size_t *ndst);
#else

    iconv_t                 init_iconv_to_wchar_t(const char *charset);

    iconv_t                 init_iconv_from_wchar_t(const char *charset);

#endif /* PLATFORM_WINDOWS */

    /**
     * Read UTF-16 codepoint from the NULL-terminated UTF-16 string, replace invalid
     * code sequence by 0xfffd code point
     * @param str pointer to the NULL-terminated UTF-16 string
     * @return code point
     */
    lsp_utf32_t             read_utf16le_codepoint(const lsp_utf16_t **str);
    lsp_utf32_t             read_utf16be_codepoint(const lsp_utf16_t **str);
    inline lsp_utf32_t      read_utf16_codepoint(const lsp_utf16_t **str) { return __IF_LEBE(read_utf16le_codepoint, read_utf16be_codepoint)(str); };

    /**
     * Read UTF-16 codepoint from the NULL-terminated UTF-16 string in streaming mode,
     * replace invalid code sequence by 0xfffd code point
     * @param str pointer to the pointer to the NULL-terminated UTF-16 string
     * @param nsrc counter containing number of unread array elements
     * @param force process data as there will be no future data on the input
     * @return parsed code point or LSP_UTF32_EOF as end of sequence
     */
    lsp_utf32_t             read_utf16le_streaming(const lsp_utf16_t **str, size_t *nsrc, bool force);
    lsp_utf32_t             read_utf16be_streaming(const lsp_utf16_t **str, size_t *nsrc, bool force);
    inline lsp_utf32_t      read_utf16_streaming(const lsp_utf16_t **str, size_t *nsrc, bool force) { return __IF_LEBE(read_utf16le_streaming, read_utf16be_streaming)(str, nsrc, force); }

    /**
     * Read UTF-16 codepoint from the NULL-terminated UTF-8 string, replace invalid
     * code sequence by 0xfffd code point
     * @param str pointer to the NULL-terminated UTF-8 string
     * @return code point
     */
    lsp_utf32_t             read_utf8_codepoint(const char **str);

    /**
     * Read UTF-8 codepoint from the NULL-terminated UTF-8 string in streaming mode,
     * replace invalid code sequence by 0xfffd code point
     * @param str pointer to the pointer to the NULL-terminated UTF-8 string
     * @param nsrc counter containing number of unread array elements
     * @param force process data as there will be no future data on the input
     * @return parsed code point or LSP_UTF32_EOF as end of sequence
     */
    lsp_utf32_t             read_utf8_streaming(const char **str, size_t *nsrc, bool force);

    /**
     * Write UTF-8 code point to buffer, buffer should be of enough size
     * @param str pointer to target buffer
     * @param cp code point to write
     */
    void                    write_utf8_codepoint(char **str, lsp_utf32_t cp);

    /**
     * Write UTF-16 code point to buffer, buffer should be of enough size
     * @param str pointer to target buffer
     * @param cp code point to write
     */
    void                    write_utf16le_codepoint(lsp_utf16_t **str, lsp_utf32_t cp);
    void                    write_utf16be_codepoint(lsp_utf16_t **str, lsp_utf32_t cp);
    inline void             write_utf16_codepoint(lsp_utf16_t **str, lsp_utf32_t cp) { return __IF_LEBE(write_utf16le_codepoint, write_utf16be_codepoint)(str, cp); }

    /**
     * Encode NULL-terminated UTF-8 string to NULL-terminated UTF-16 string
     * @param str string to encode
     * @return pointer to allocated UTF-16 string that should be free()'d after use
     */
    lsp_utf16_t            *utf8_to_utf16le(const char *str);
    lsp_utf16_t            *utf8_to_utf16be(const char *str);
    inline lsp_utf16_t     *utf8_to_utf16(const char *str) { return __IF_LEBE(utf8_to_utf16le, utf8_to_utf16be)(str); }

    /**
     * Encode NULL-terminated UTF-8 string to NULL-terminated UTF-16 string
     * @param dst destination buffer to store data
     * @param src string to encode
     * @param count number of elements available in destination buffer
     * @return number of elements produced (including zero-terminating character) or zero if there is not enough space
     */
    size_t                  utf8_to_utf16le(lsp_utf16_t *dst, const char *src, size_t count);
    size_t                  utf8_to_utf16be(lsp_utf16_t *dst, const char *src, size_t count);
    inline size_t           utf8_to_utf16(lsp_utf16_t *dst, const char *src, size_t count) { return __IF_LEBE(utf8_to_utf16le, utf8_to_utf16be)(dst, src, count); }

    /**
     * Encode sequence of UTF-8 characters into sequence of UTF-16 characters
     * @param dst target buffer to store characters
     * @param ndst number of elements available in target buffer
     * @param src source buffer to read characters
     * @param nsrc number of elements available in source buffer
     * @param force force flag that treats the input block as last in the character sequence
     * @return number of processed code points
     */
    size_t                  utf8_to_utf16le(lsp_utf16_t *dst, size_t *ndst, const char *src, size_t *nsrc, bool force);
    size_t                  utf8_to_utf16be(lsp_utf16_t *dst, size_t *ndst, const char *src, size_t *nsrc, bool force);
    inline size_t           utf8_to_utf16(lsp_utf16_t *dst, size_t *ndst, const char *src, size_t *nsrc, bool force) { return __IF_LEBE(utf8_to_utf16le, utf8_to_utf16be)(dst, ndst, src, nsrc, force); }

    /**
     * Encode NULL-terminated UTF-8 string to NULL-terminated UTF-32 string
     * @param str string to encode
     * @return pointer to allocated UTF-32 string that should be free()'d after use
     */
    lsp_utf32_t            *utf8_to_utf32le(const char *str);
    lsp_utf32_t            *utf8_to_utf32be(const char *str);
    inline lsp_utf32_t     *utf8_to_utf32(const char *str) { return __IF_LEBE(utf8_to_utf32le, utf8_to_utf32be)(str); };

    /**
     * Encode NULL-terminated UTF-8 string to NULL-terminated UTF-32 string
     * @param dst destination buffer to store data
     * @param src string to encode
     * @param count number of elements available in destination buffer
     * @return number of elements produced (including zero-terminating character) or negative value if there is not enough space
     */
    size_t                  utf8_to_utf32le(lsp_utf32_t *dst, const char *src, size_t count);
    size_t                  utf8_to_utf32be(lsp_utf32_t *dst, const char *src, size_t count);
    inline size_t           utf8_to_utf32(lsp_utf32_t *dst, const char *src, size_t count) { return __IF_LEBE(utf8_to_utf32le, utf8_to_utf32be)(dst, src, count); }

    /**
     * Encode sequence of UTF-8 characters into sequence of UTF-32 characters
     * @param dst target buffer to store characters
     * @param ndst number of elements available in target buffer
     * @param src source buffer to read characters
     * @param nsrc number of elements available in source buffer
     * @param force force flag that treats the input block as last in the character sequence
     * @return number of processed code points
     */
    size_t                  utf8_to_utf32le(lsp_utf32_t *dst, size_t *ndst, const char *src, size_t *nsrc, bool force);
    size_t                  utf8_to_utf32be(lsp_utf32_t *dst, size_t *ndst, const char *src, size_t *nsrc, bool force);
    inline size_t           utf8_to_utf32(lsp_utf32_t *dst, size_t *ndst, const char *src, size_t *nsrc, bool force) { return __IF_LEBE(utf8_to_utf32le, utf8_to_utf32be)(dst, ndst, src, nsrc, force); };

    /**
     * Encode NULL-terminated UTF-16 string to NULL-terminated UTF-8 string
     * @param str string to encode
     * @return pointer to allocated UTF-8 string that should be free()'d after use
     */
    char                   *utf16le_to_utf8(const lsp_utf16_t *str);
    char                   *utf16be_to_utf8(const lsp_utf16_t *str);
    inline char            *utf16_to_utf8(const lsp_utf16_t *str) { return __IF_LEBE(utf16le_to_utf8, utf16be_to_utf8)(str); };

    /**
     * Encode NULL-terminated UTF-16 string to NULL-terminated UTF-8 string
     * @param dst destination buffer to store data
     * @param src string to encode
     * @param count number of elements available in destination buffer
     * @return number of elements produced (including zero-terminating character) or negative value if there is not enough space
     */
    size_t                  utf16le_to_utf8(char *dst, const lsp_utf16_t *src, size_t count);
    size_t                  utf16be_to_utf8(char *dst, const lsp_utf16_t *src, size_t count);
    inline size_t           utf16_to_utf8(char *dst, const lsp_utf16_t *src, size_t count) { return __IF_LEBE(utf16le_to_utf8, utf16be_to_utf8)(dst, src, count); }

    /**
     * Encode sequence of UTF-16 characters into sequence of UTF-16 characters
     * @param dst target buffer to store characters
     * @param ndst number of elements available in target buffer
     * @param src source buffer to read characters
     * @param nsrc number of elements available in source buffer
     * @param force force flag that treats the input block as last in the character sequence
     * @return number of processed code points
     */
    size_t                  utf16le_to_utf8(char *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force);
    size_t                  utf16be_to_utf8(char *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force);
    inline size_t           utf16_to_utf8(char *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf16le_to_utf8, utf16be_to_utf8)(dst, ndst, src, nsrc, force); };

    /**
     * Encode NULL-terminated UTF-16 string to NULL-terminated UTF-32 string
     * @param str string to encode
     * @return pointer to allocated UTF-32 string that should be free()'d after use
     */
    lsp_utf32_t            *utf16le_to_utf32le(const lsp_utf16_t *str);
    lsp_utf32_t            *utf16le_to_utf32be(const lsp_utf16_t *str);
    lsp_utf32_t            *utf16be_to_utf32le(const lsp_utf16_t *str);
    lsp_utf32_t            *utf16be_to_utf32be(const lsp_utf16_t *str);

    inline lsp_utf32_t     *utf16le_to_utf32(const lsp_utf16_t *str) { return __IF_LEBE(utf16le_to_utf32le, utf16le_to_utf32be)(str); }
    inline lsp_utf32_t     *utf16be_to_utf32(const lsp_utf16_t *str) { return __IF_LEBE(utf16be_to_utf32le, utf16be_to_utf32be)(str); }
    inline lsp_utf32_t     *utf16_to_utf32le(const lsp_utf16_t *str) { return __IF_LEBE(utf16le_to_utf32le, utf16be_to_utf32le)(str); }
    inline lsp_utf32_t     *utf16_to_utf32be(const lsp_utf16_t *str) { return __IF_LEBE(utf16le_to_utf32be, utf16be_to_utf32be)(str); }
    inline lsp_utf32_t     *utf16_to_utf32(const lsp_utf16_t *str) { return __IF_LEBE(utf16le_to_utf32le, utf16be_to_utf32be)(str); }

    /**
     * Encode NULL-terminated UTF-16 string to NULL-terminated UTF-32 string
     * @param dst destination buffer to store data
     * @param src string to encode
     * @param count number of elements available in destination buffer
     * @return number of elements produced (including zero-terminating character) or negative value if there is not enough space
     */
    size_t                  utf16le_to_utf32le(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count);
    size_t                  utf16le_to_utf32be(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count);
    size_t                  utf16be_to_utf32le(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count);
    size_t                  utf16be_to_utf32be(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count);

    inline size_t           utf16le_to_utf32(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count) { return __IF_LEBE(utf16le_to_utf32le, utf16le_to_utf32be)(dst, src, count); }
    inline size_t           utf16be_to_utf32(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count) { return __IF_LEBE(utf16be_to_utf32le, utf16be_to_utf32be)(dst, src, count); }
    inline size_t           utf16_to_utf32le(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count) { return __IF_LEBE(utf16le_to_utf32le, utf16be_to_utf32le)(dst, src, count); }
    inline size_t           utf16_to_utf32be(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count) { return __IF_LEBE(utf16le_to_utf32be, utf16be_to_utf32be)(dst, src, count); }
    inline size_t           utf16_to_utf32(lsp_utf32_t *dst, const lsp_utf16_t *src, size_t count) { return __IF_LEBE(utf16le_to_utf32le, utf16be_to_utf32be)(dst, src, count); }

    /**
     * Encode sequence of UTF-16 characters into sequence of UTF-32 characters
     * @param dst target buffer to store characters
     * @param ndst number of elements available in target buffer
     * @param src source buffer to read characters
     * @param nsrc number of elements available in source buffer
     * @param force force flag that treats the input block as last in the character sequence
     * @return number of processed code points
     */
    size_t                  utf16le_to_utf32le(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force);
    size_t                  utf16le_to_utf32be(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force);
    size_t                  utf16be_to_utf32le(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force);
    size_t                  utf16be_to_utf32be(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force);

    inline size_t           utf16le_to_utf32(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf16le_to_utf32le, utf16le_to_utf32be)(dst, ndst, src, nsrc, force); }
    inline size_t           utf16be_to_utf32(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf16be_to_utf32le, utf16be_to_utf32be)(dst, ndst, src, nsrc, force); }
    inline size_t           utf16_to_utf32le(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf16le_to_utf32le, utf16be_to_utf32le)(dst, ndst, src, nsrc, force); }
    inline size_t           utf16_to_utf32be(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf16le_to_utf32be, utf16be_to_utf32be)(dst, ndst, src, nsrc, force); }
    inline size_t           utf16_to_utf32(lsp_utf32_t *dst, size_t *ndst, const lsp_utf16_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf16le_to_utf32le, utf16be_to_utf32be)(dst, ndst, src, nsrc, force); }

    /**
     * Encode NULL-terminated UTF-32 string to NULL-terminated UTF-8 string
     * @param str string to encode
     * @return pointer to allocated UTF-16 string that should be free()'d after use
     */
    char                   *utf32le_to_utf8(const lsp_utf32_t *str);
    char                   *utf32be_to_utf8(const lsp_utf32_t *str);
    inline char            *utf32_to_utf8(const lsp_utf32_t *str) { return __IF_LEBE(utf32le_to_utf8, utf32be_to_utf8)(str); };

    /**
     * Encode NULL-terminated UTF-32 string to NULL-terminated UTF-8 string
     * @param dst destination buffer to store data
     * @param src string to encode
     * @param count number of elements available in destination buffer
     * @return number of elements produced (including zero-terminating character) or negative value if there is not enough space
     */
    size_t                  utf32le_to_utf8(char *dst, const lsp_utf32_t *src, size_t count);
    size_t                  utf32be_to_utf8(char *dst, const lsp_utf32_t *src, size_t count);
    inline size_t           utf32_to_utf8(char *dst, const lsp_utf32_t *src, size_t count) { return __IF_LEBE(utf32le_to_utf8, utf32be_to_utf8)(dst, src, count); };

    /**
     * Encode sequence of UTF-8 characters into sequence of UTF-16 characters
     * @param dst target buffer to store characters
     * @param ndst number of elements available in target buffer
     * @param src source buffer to read characters
     * @param nsrc number of elements available in source buffer
     * @param force force flag that treats the input block as last in the character sequence
     * @return number of processed code points
     */
    size_t                  utf32le_to_utf8(char *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force);
    size_t                  utf32be_to_utf8(char *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force);
    inline size_t           utf32_to_utf8(char *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf32le_to_utf8, utf32be_to_utf8)(dst, ndst, src, nsrc, force); }

    /**
     * Encode NULL-terminated UTF-32 string to NULL-terminated UTF-16 string
     * @param str string to encode
     * @return pointer to allocated UTF-16 string that should be free()'d after use
     */
    lsp_utf16_t            *utf32le_to_utf16le(const lsp_utf32_t *str);
    lsp_utf16_t            *utf32le_to_utf16be(const lsp_utf32_t *str);
    lsp_utf16_t            *utf32be_to_utf16le(const lsp_utf32_t *str);
    lsp_utf16_t            *utf32be_to_utf16be(const lsp_utf32_t *str);

    inline lsp_utf16_t     *utf32le_to_utf16(const lsp_utf32_t *str)    { return __IF_LEBE(utf32le_to_utf16le, utf32le_to_utf16be)(str);  }
    inline lsp_utf16_t     *utf32be_to_utf16(const lsp_utf32_t *str)    { return __IF_LEBE(utf32be_to_utf16le, utf32be_to_utf16be)(str);  }
    inline lsp_utf16_t     *utf32_to_utf16le(const lsp_utf32_t *str)    { return __IF_LEBE(utf32le_to_utf16le, utf32be_to_utf16le)(str);  }
    inline lsp_utf16_t     *utf32_to_utf16be(const lsp_utf32_t *str)    { return __IF_LEBE(utf32le_to_utf16be, utf32be_to_utf16be)(str);  }
    inline lsp_utf16_t     *utf32_to_utf16(const lsp_utf32_t *str)      { return __IF_LEBE(utf32le_to_utf16le, utf32be_to_utf16be)(str);  }

    /**
     * Encode NULL-terminated UTF-32 string to NULL-terminated UTF-16 string
     * @param dst destination buffer to store data
     * @param src string to encode
     * @param count number of elements available in destination buffer
     * @return number of elements produced (including zero-terminating character) or negative value if there is not enough space
     */
    size_t                  utf32le_to_utf16le(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count);
    size_t                  utf32le_to_utf16be(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count);
    size_t                  utf32be_to_utf16le(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count);
    size_t                  utf32be_to_utf16be(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count);

    inline size_t           utf32le_to_utf16(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count)    { return __IF_LEBE(utf32le_to_utf16le, utf32le_to_utf16be)(dst, src, count);  }
    inline size_t           utf32be_to_utf16(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count)    { return __IF_LEBE(utf32be_to_utf16le, utf32be_to_utf16be)(dst, src, count);  }
    inline size_t           utf32_to_utf16le(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count)    { return __IF_LEBE(utf32le_to_utf16le, utf32be_to_utf16le)(dst, src, count);  }
    inline size_t           utf32_to_utf16be(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count)    { return __IF_LEBE(utf32le_to_utf16be, utf32be_to_utf16be)(dst, src, count);  }
    inline size_t           utf32_to_utf16(lsp_utf16_t *dst, const lsp_utf32_t *src, size_t count)      { return __IF_LEBE(utf32le_to_utf16le, utf32be_to_utf16be)(dst, src, count);  }

    /**
     * Encode sequence of UTF-8 characters into sequence of UTF-16 characters
     * @param dst target buffer to store characters
     * @param ndst number of elements available in target buffer
     * @param src source buffer to read characters
     * @param nsrc number of elements available in source buffer
     * @param force force flag that treats the input block as last in the character sequence
     * @return number of processed code points
     */
    size_t                  utf32le_to_utf16le(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force);
    size_t                  utf32le_to_utf16be(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force);
    size_t                  utf32be_to_utf16le(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force);
    size_t                  utf32be_to_utf16be(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force);

    inline size_t           utf32_to_utf16le(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf32le_to_utf16le, utf32be_to_utf16le)(dst, ndst, src, nsrc, force); }
    inline size_t           utf32_to_utf16be(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf32le_to_utf16be, utf32be_to_utf16be)(dst, ndst, src, nsrc, force); }
    inline size_t           utf32le_to_utf16(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf32le_to_utf16le, utf32le_to_utf16be)(dst, ndst, src, nsrc, force); }
    inline size_t           utf32be_to_utf16(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force) { return __IF_LEBE(utf32be_to_utf16le, utf32be_to_utf16be)(dst, ndst, src, nsrc, force); }
    inline size_t           utf32_to_utf16(lsp_utf16_t *dst, size_t *ndst, const lsp_utf32_t *src, size_t *nsrc, bool force)   { return __IF_LEBE(utf32le_to_utf16le, utf32be_to_utf16be)(dst, ndst, src, nsrc, force); }

    /**
     * Compare two character sequences.
     * @param s1 character sequence 1
     * @param s2 character sequence 2
     * @param count number of characters to compare, you must be sure that both sequences have at least count characters
     * @return comparison result
     */
#ifdef ARCH_LE
    inline int              wchar_cmp(const lsp_wchar_t *s1, const lsp_wchar_t *s2, size_t count)   {   return ::memcmp(s1, s2, count * sizeof(lsp_wchar_t));         }
#else
    int                     wchar_cmp(const lsp_wchar_t *s1, const lsp_wchar_t *s2, size_t count);
#endif

    int                     wchar_casecmp(const lsp_wchar_t *s1, const lsp_wchar_t *s2, size_t count);

    /**
     * Convert character to lower case
     * @param c character to convert
     * @return converted character
     */
    lsp_wchar_t             to_lower(lsp_wchar_t c);

    /**
     * Convert character to upper case
     * @param c character to convert
     * @return converted character
     */
    lsp_wchar_t             to_upper(lsp_wchar_t c);

} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_CHARSET_H_ */
