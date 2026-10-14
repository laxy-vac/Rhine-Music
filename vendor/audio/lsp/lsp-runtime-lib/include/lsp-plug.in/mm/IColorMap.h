/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 25 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_MM_ICOLORMAP_H_
#define LSP_PLUG_IN_MM_ICOLORMAP_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/runtime/Color.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace mm
    {
        /**
         * Color map class for unmapping colors from symbolic names.
         */
        class IColorMap
        {
            private:
                lltl::parray<IColorMap> vNested;

            public:
                IColorMap();
                virtual ~IColorMap();

            public:
                /**
                 * Resolve color
                 * @param c reference to color to store value
                 * @param name color name
                 * @return true if color has been resolved
                 */
                virtual bool resolve(Color & c, const char *name) const noexcept;

                /**
                 * Resolve color
                 * @param c reference to color to store value
                 * @param name color name
                 * @return true if color has been resolved
                 */
                virtual bool resolve(Color & c, const LSPString & name) const noexcept;

            public:
                /**
                 * Link nested color map. If this color map does not contain color,
                 * the added color maps will be polled in order of linkage.
                 *
                 * @param map pointer to color map to link
                 * @return true if color map was linked
                 */
                inline bool link(IColorMap *map)                                        { return vNested.add(map);                                              }

                /**
                 * Resolve color
                 * @param pointer to color to store value
                 * @param name color name
                 * @return true if color has been resolved
                 */
                inline bool resolve(Color *c, const char *name) const noexcept          { return (c != NULL) ? resolve(*c, name) : false;                       }

                /**
                 * Resolve color
                 * @param pointer to color to store value
                 * @param name color name
                 * @return true if color has been resolved
                 */
                inline bool resolve(Color *c, const LSPString *name) const noexcept     { return ((c != NULL) && (name != NULL)) ? resolve(*c, *name) : false;  }

                /**
                 * Resolve color
                 * @param pointer to color to store value
                 * @param name color name
                 * @return true if color has been resolved
                 */
                inline bool resolve(Color *c, const LSPString & name) const noexcept    { return (c != NULL) ? resolve(*c, name) : false;                       }

                /**
                 * Resolve color
                 * @param pointer to color to store value
                 * @param name color name
                 * @return true if color has been resolved
                 */
                inline bool resolve(Color & c, const LSPString *name) const noexcept    { return (name != NULL) ? resolve(c, *name) : false;                    }
        };

    } /* namespace mm */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_MM_ICOLORMAP_H_ */
