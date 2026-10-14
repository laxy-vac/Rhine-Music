/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 мая 2019 г.
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

#ifndef LSP_PLUG_IN_PROTOCOL_OSC_PATTERN_H_
#define LSP_PLUG_IN_PROTOCOL_OSC_PATTERN_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/protocol/osc/types.h>

namespace lsp
{
    namespace osc
    {
        typedef struct pattern_t
        {
            size_t          nparts;
            char           *format;
            char          **parts;
        } pattern_t;

        /**
         * Create and prepare pattern, this is not RT-safe method.
         *
         * @param pattern pattern to compile
         * @param format pattern format
         * @return status of operation
         */
        status_t    pattern_create(pattern_t *pattern, const char *format);

        /**
         * Get original format text of the pattern
         * @param pattern pattern to retrieve text format
         * @param format pointer to store the output format
         * @return status of operation
         */
        status_t    pattern_get_format(pattern_t *pattern, const char **format);

        /**
         * Match the address to the pattern, this is thread-safe and RT-safe method
         * @param pattern the pattern to perform match
         * @param address address to match
         * @return true if pattern matches, false if not or error occurred
         */
        bool        pattern_match(const pattern_t *pattern, const char *address);

        /**
         * Destroy pattern
         * @param pattern pattern to destroy
         * @return status of operation
         */
        status_t    pattern_destroy(pattern_t *pattern);
    } /* namespace osc */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_PROTOCOL_OSC_PATTERN_H_ */
