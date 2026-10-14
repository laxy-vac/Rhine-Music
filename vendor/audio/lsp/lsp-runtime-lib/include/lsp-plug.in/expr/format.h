/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 25 февр. 2020 г.
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

#ifndef LSP_PLUG_IN_EXPR_FORMAT_H_
#define LSP_PLUG_IN_EXPR_FORMAT_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IOutSequence.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/expr/Parameters.h>

namespace lsp
{
    namespace expr
    {
        /**
         * Format string syntax:
         *   format-string: element
         *   element: { character | escape_sequence | format_specifier } [element]
         *   character: any character except '\', '{', '}'
         *   escape_sequence: '\' { '\' | '{' | '}' }
         *   format_specifier: '{' format_description '}'
         *   format_description: modifiers
         *   modifiers: { parameter_name | parameter_index | padding | alignment | type | width } [ modifiers ]
         *   parameter_name: '@' identifier_first [identifier_next]
         *   parameter_index: '[' parameter_number ']'
         *   padding: { padding_left | padding_right }
         *   alignment: { align_left | align_to_left | align_from_left | align_middle | align_from_right | align_to_right | align_right }
         *   type: '%' [ type_sign ] [ type_width ] [ type_specifier ]
         *   width: ':' decimal_digits
         *   identifier_first: any character of 'a'-'z', 'A'-'Z' and '_'
         *   identifier_next: { identifier_first | '0'-'9' } [ identifier_next ]
         *   parameter_number: decimal_digits
         *   decimal_digits: '0'-'9' [ decimal_digits ]
         *   padding_left: '^' character
         *   padding_right: '$' character
         *   character: any possible character except '\0'
         *   align_left: '<'
         *   align_to_left: '<' '|'
         *   align_from_left: '>' '|'
         *   align_middle: '|'
         *   align_from_right: '|' '<'
         *   align_to_right: '|' '>'
         *   align_right: '>'
         *   type_sign: '+'
         *   type_width: decimal_digits [ type_fraction ]
         *   type_fraction: '.' decimal_digits
         *   type_specifier: '%' { decimal_type | float_type | binary_type | octal_type | hexadecimal_type | boolean_type | string_type | text_type }
         *   decimal_type: { 'i' | 'd' | 'u' }
         *   float_type: { 'f' | 'F' | 'e' | 'E' }
         *   binary_type: 'b'
         *   octal_type: 'o'
         *   hexadecimal_type: { 'x' | 'X' }
         *   boolean_type: { 'l' | 'L' } [ { 'l' | 'L' } ]
         *   string_type: 's'
         *   text_type: { 't' | 'T' } [ { 't' | 'T' } ]
         *
         * Example formats:
         *   "The value with name 'x' is: {@x}"
         *   "The value with index 1 is: {[1]}"
         *   "The zero-padded integer from left is: {>^0@x}"
         *   "The hex integer from left is: {>^0@x}"
         *   "The 8-digit octal number inside of underscored field of 16 digits aligned to center: {|^_%8o:16$_}"
         *
         * Each format specifier can contain:
         *   Parameter reference:
         *     - named: {@parameter}
         *     - indexed: [parameter_index]
         *   Padding character specification:
         *     - preceding character: ^character
         *     - subsequent character: $character
         *   Alignment:
         *     - left alignment: <
         *     - right alignment: >
         *     - middle alignment: |
         *     - middle alignment with left offset: <|
         *     - middle alignment with right offset: |>
         *     - left alignment with 1/4 offset: |<
         *     - right alignment with 1/4 offset: >|
         *   Type specifier:
         *     - permanent sign presence flag: +
         *     - value width - minimum number of digits (including dot character for floating point values)
         *     - fraction width (number of fraction digits for floating point values)
         *     - data type specifier:
         *       - E: exponential floating point value upper-case 'INF' and 'NAN' values
         *       - F: floating point value with upper-case 'INF' and 'NAN' values
         *       - L: upper-case boolean value ('TRUE' and 'FALSE')
         *       - Ll: camel-case boolean value ('True' and 'False')
         *       - S: string (same as s)
         *       - T: text, all characters in upper-case
         *       - Tt: text, first character in upper-case, all others in lower-case
         *       - X: upper-case hexadecimal integers
         *       - b: binary integers
         *       - d: decimal integers (same to i)
         *       - e: exponential floating point value lower-case 'inf' and 'nan' values
         *       - f: floating point value with lower-case 'inf' and 'nan' values
         *       - i: decimal integers (same to d)
         *       - l: lower-case boolean value ('true' and 'false')
         *       - lL: reverse camel-case boolean value ('tRUE' and 'fALSE')
         *       - o: octal integers
         *       - s: string (same as S)
         *       - t: text, all characters in lower-case
         *       - tT: text, first character in lower-case, all others in upper-case
         *       - u: unsigned integers
         *       - x: lower-case hexadecimal integers
         *   Width specifier - the minimum number of characters to allocate for printing the value
         *
         */

        /**
         * Format the set of parameters provided by Resolver using input character
         * sequence as format specifier and output the result to output character
         * sequence
         *
         * @param out output character sequence
         * @param fmt format specifier
         * @param r parameter resolver
         * @return status of operation
         */
        status_t format(io::IOutSequence *out, io::IInSequence *fmt, const Parameters *r);

        /**
         * Format the set of parameters provided by Resolver using format string
         * and output the result to output character sequence
         *
         * @param out output character sequence
         * @param fmt format specifier (UTF-8 character sequence)
         * @param r parameter resolver
         * @return status of operation
         */
        status_t format(io::IOutSequence *out, const char *fmt, const Parameters *r);

        /**
         * Format the set of parameters provided by Resolver using format string
         * and output the result to output character sequence
         *
         * @param out output character sequence
         * @param fmt format specifier
         * @param r parameter resolver
         * @return status of operation
         */
        status_t format(io::IOutSequence *out, const LSPString *fmt, const Parameters *r);

        /**
         * Format the set of parameters provided by Resolver using input character
         * sequence as format specifier and output the result to string
         *
         * @param out output string
         * @param fmt format specifier
         * @param r parameter resolver
         * @return status of operation
         */
        status_t format(LSPString *out, io::IInSequence *fmt, const Parameters *r);

        /**
         * Format the set of parameters provided by Resolver using format string
         * and output the result to string
         *
         * @param out output string
         * @param fmt format specifier (UTF-8 character sequence)
         * @param r parameter resolver
         * @return status of operation
         */
        status_t format(LSPString *out, const char *fmt, const Parameters *r);

        /**
         * Format the set of parameters provided by Resolver using format string
         * and output the result to string
         *
         * @param out output string
         * @param fmt format specifier
         * @param r parameter resolver
         * @return status of operation
         */
        status_t format(LSPString *out, const LSPString *fmt, const Parameters *r);
    }
}


#endif /* LSP_PLUG_IN_EXPR_FORMAT_H_ */
