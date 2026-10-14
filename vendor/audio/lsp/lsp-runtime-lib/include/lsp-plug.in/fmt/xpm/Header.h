/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 20 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_FMT_XPM_HEADER_H_
#define LSP_PLUG_IN_FMT_XPM_HEADER_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace xpm
    {
        enum version_t
        {
            VERSION_XPM1,
            VERSION_XPM2,
            VERSION_XPM3
        };

        typedef struct header_t
        {
            version_t   version;            // Version of XPM
            size_t      width;              // Image width
            size_t      height;             // Image height
            size_t      num_colors;         // Number of colors
            size_t      chars_per_pixel;    // Number of characters per one pixel
            size_t      x_hotspot;          // Image X hot-spot
            size_t      y_hotspot;          // Image Y hot-spot
            bool        has_extensions;     // Presense of extensions
        } header_t;
    } /* namespace xpm */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_XPM_HEADER_H_ */
