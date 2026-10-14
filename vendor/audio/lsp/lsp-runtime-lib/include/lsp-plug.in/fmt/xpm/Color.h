/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 18 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_FMT_XPM_COLOR_H_
#define LSP_PLUG_IN_FMT_XPM_COLOR_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/fmt/xpm/ColorItem.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * XPM2/XPM3 color
         */
        class LSP_RUNTIME_LIB_PUBLIC Color
        {
            private:
                char       *sCode;
                ColorItem   sMono;          // XPM: mono visual ('m')
                ColorItem   sSymbolic;      // XPM: symbolic name ('s')
                ColorItem   sGray4;         // XPM: 4-level grayscale ('g4')
                ColorItem   sGray;          // XPM: grayscale with more than 4 levels ('g')
                ColorItem   sColor;         // XPM: color visual

            public:
                Color() noexcept;
                explicit Color(const char * code);
                Color(const char * code, size_t len);
                Color(const Color & src);
                Color(Color && src) noexcept;
                ~Color();

                Color & operator = (const Color & src);
                Color & operator = (Color && src) noexcept;

            public:
                inline const char *code() const noexcept                    { return sCode;             }
                bool set_code(const char *code);
                bool set_code(const char *code, size_t len);
                inline bool has_code() const noexcept                       { return sCode != NULL;     }
                bool has_code(const char *code) const noexcept;
                void clear_code();

                bool set(const Color & src);

                inline ColorItem & mono_visual() noexcept                   { return sMono;             }
                inline const ColorItem & mono_visual() const noexcept       { return sMono;             }

                inline ColorItem & symbolic_visual()noexcept                { return sSymbolic;         }
                inline const ColorItem & symbolic_visual() const noexcept   { return sSymbolic;         }

                inline ColorItem & gray4_visual() noexcept                  { return sGray4;            }
                inline const ColorItem & gray4_visual() const noexcept      { return sGray4;            }

                inline ColorItem & gray_visual() noexcept                   { return sGray;             }
                inline const ColorItem & gray_visual() const noexcept       { return sGray;             }

                inline ColorItem & color_visual() noexcept                  { return sColor;            }
                inline const ColorItem & color_visual() const noexcept      { return sColor;            }

            public:
                void swap(Color & src) noexcept;
                void swap(Color * src) noexcept;
        };

    } /* namespace xpm */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_XPM_COLOR_H_ */
