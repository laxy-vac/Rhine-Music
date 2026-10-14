/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 11 мая 2024 г.
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

#ifndef LSP_PLUG_IN_RUNTIME_UUID_H_
#define LSP_PLUG_IN_RUNTIME_UUID_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>

namespace lsp
{
    typedef struct uuid_t
    {
        union {
            uint8_t     u8[16];
            uint16_t    u16[8];
            uint32_t    u32[4];
            uint64_t    u64[2];
        };
    } uuid_t;

    /**
     * Generate UUID
     * @param uuid UUID to generate
     */
    void generate_uuid(uuid_t *uuid);

    /**
     * Format UUID (plain hex values without dashes)
     * @param dst buffer to store UUID (should be at least 33 characters long)
     * @param upper use upper case for hex digits
     * @param uuid UUID to format
     * @return ponter to the zero-terminating character stored to buffer
     */
    char *format_uuid_hex(char *dst, const uuid_t *uuid, bool upper = false);

    /**
     * Format UUID (plain hex values with dashes)
     * @param dst buffer to store UUID (should be at least 37 characters long)
     * @param upper use upper case for hex digits
     * @param uuid UUID to format
     * @return ponter to the zero-terminating character stored to buffer
     */
    char *format_uuid_dashed(char *dst, const uuid_t *uuid, bool upper = false);

    /**
     * Format UID (plain text values without dashes), non-standard Base64 table is used because
     * standard Base64 table allows to use file separator characters
     * @param dst buffer to store UUID (should be at least 23 characters long)
     * @return ponter to the zero-terminating character stored to buffer
     */
    char *format_uuid_base64(char *dst, const uuid_t *uuid);

} /* namespace lsp */

#endif /* LSP_PLUG_IN_RUNTIME_UUID_H_ */
