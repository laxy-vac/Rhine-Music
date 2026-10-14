/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 сент. 2019 г.
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

#ifndef LSP_PLUG_IN_EXPR_TOKEN_H_
#define LSP_PLUG_IN_EXPR_TOKEN_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace expr
    {
        enum token_t
        {
            TT_IDENTIFIER,  // Identifier
            TT_BAREWORD,    // Bareword
            TT_IVALUE,      // Integer value
            TT_FVALUE,      // Floating-point value
            TT_STRING,      // String literal
            TT_COLOR,       // Color code: one of @HHSSLL, #RRGGBB

            TT_LBRACE,      // (
            TT_RBRACE,      // )
            TT_LQBRACE,     // [
            TT_RQBRACE,     // ]
            TT_LCBRACE,     // {
            TT_RCBRACE,     // }
            TT_SHARP,       // #
            TT_AT,          // @

            // Constants
            TT_TRUE,        // true
            TT_FALSE,       // false
            TT_NULL,        // null
            TT_UNDEF,       // undef
            TT_PI,          // pi
            TT_E,           // e

            // Logical operations
            TT_AND,         // &, &&, and
            TT_OR,          // |, ||, or
            TT_NOT,         // !, not
            TT_XOR,         // ^, ^^, xor

            // Binary operations
            TT_BAND,        // band
            TT_BOR,         // bor
            TT_BNOT,        // ~, bnot
            TT_BXOR,        // bxor

            // Floating-point operations
            TT_ADD,         // +
            TT_SUB,         // -
            TT_ADDSYM,      // add
            TT_SUBSYM,      // sub
            TT_MUL,         // *, mul
            TT_POW,         // **, pow
            TT_DIV,         // /, div
            TT_FMOD,        // fmod

            // Integer operations
            TT_IADD,        // iadd
            TT_ISUB,        // isub
            TT_IMUL,        // imul
            TT_IDIV,        // idiv
            TT_IMOD,        // %, mod, imod

            // Floating-point comparison
            TT_LESS,        // <, lt, nge
            TT_GREATER,     // >, gt, nle
            TT_LESS_EQ,     // <=, le, ngt
            TT_GREATER_EQ,  // >=, ge, nlt
            TT_NOT_EQ,      // !=, <>, ne
            TT_EQ,          // =, ==, eq
            TT_CMP,         // <=>, cmp

            // Integer comparison
            TT_ILESS,       // ilt, inge
            TT_IGREATER,    // igt, inle
            TT_ILESS_EQ,    // ile, ingt
            TT_IGREATER_EQ, // ige, ingt
            TT_INOT_EQ,     // ine
            TT_IEQ,         // ie, ieq
            TT_ICMP,        // icmp

            // String operations
            TT_SCAT,        // String concat
            TT_SREP,        // String repeat
            TT_SLEN,        // String length
            TT_SREV,        // String reverse
            TT_SUPR,        // String upper
            TT_SLWR,        // String lower

            // Casts
            TT_INT,         // Cast to integer
            TT_FLOAT,       // Cast to float
            TT_STR,         // Cast to string
            TT_BOOL,        // Cast to bool

            // Math functions
            TT_SIN,         // Sine
            TT_COS,         // Cosine
            TT_TAN,         // Tangent
            TT_ASIN,        // Arcsine
            TT_ACOS,        // Arccosine
            TT_ATAN,        // Arctangent
            TT_LOGE,        // Natural logarithm
            TT_LOGD,        // Decimal logarithm
            TT_LOG2,        // Binary logarithm
            TT_EXP,         // Exponent
            TT_SQRT,        // Square root
            TT_RAD,         // Radians to degrees
            TT_DEG,         // Degrees to radians
            TT_ABS,         // Absolute value

            // Misc operations
            TT_EX,          // ex

            // Special measuring units
            TT_DB,          // db

            // Different operators
            TT_QUESTION,    // ?
            TT_COLON,       // :
            TT_SEMICOLON,   // ;
            TT_COMMA,       // ,

            // Control tokens
            TT_UNKNOWN,     // Unknown token
            TT_EOF,         // End of file reached
            TT_ERROR        // error
        };

        enum token_flags_t
        {
            TF_NONE             = 0,
            TF_GET              = 1 << 0,   // Get new token, don't return current
            TF_XSIGN            = 1 << 1,   // Interpret sign as operator, not sign of numeric value
            TF_BAREWORD         = 1 << 2,   // Treat barewords as identifiers
            TF_XKEYWORDS        = 1 << 3,   // Exclude keywords, treat all keywords as TT_BAREWORD
            TF_COLOR            = 1 << 4    // Lookup for colors (@HSL and #RGB)
        };
    } /* namespace expr */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_EXPR_TOKEN_H_ */
