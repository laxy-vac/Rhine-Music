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

#ifndef LSP_PLUG_IN_FMT_XPM_COLORITEM_H_
#define LSP_PLUG_IN_FMT_XPM_COLORITEM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/runtime/Color.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * XPM color item
         */
        class ColorItem
        {
            private:
                enum state_t
                {
                    STATE_UNSET         = 1 << 0,
                    STATE_NAME          = 1 << 1,
                    STATE_COLOR32       = 1 << 2,
                    STATE_COLOR64       = 1 << 3
                };

            private:
                union
                {
                    char       *sName;          // Name of color
                    uint32_t    nColor32;       // 32-bit color
                    uint64_t    nColor64;       // 64-bit color
                };
                state_t     enState;            // State

            public:
                ColorItem() noexcept;
                ColorItem(const ColorItem & src);
                ColorItem(ColorItem && src) noexcept;
                explicit ColorItem(const char *name);
                explicit ColorItem(uint32_t value) noexcept;
                explicit ColorItem(uint64_t value) noexcept;
                ~ColorItem();

                ColorItem & operator = (const ColorItem & src);
                ColorItem & operator = (ColorItem && src) noexcept;

            public:
                inline bool is_set() const noexcept             { return enState != STATE_UNSET;                        }
                inline bool is_wide() const noexcept            { return enState == STATE_COLOR64;                      }
                inline bool is_rgb48() const noexcept           { return enState == STATE_COLOR64;                      }
                inline bool is_regular() const noexcept         { return enState == STATE_COLOR32;                      }
                inline bool is_rgb24() const noexcept           { return enState == STATE_COLOR32;                      }
                inline bool is_name() const noexcept            { return enState == STATE_NAME;                         }
                inline bool is_color() const noexcept           { return (enState == STATE_COLOR64) || (enState == STATE_COLOR32);  }
                inline bool is_rgb() const noexcept             { return (enState == STATE_COLOR64) || (enState == STATE_COLOR32);  }
                inline bool has_name() const noexcept           { return (enState == STATE_NAME) && (sName != NULL);    }
                bool has_name(const char *name) const noexcept;
                inline bool is_none() const noexcept            { return has_name("None");                              }

                inline const char *name() const noexcept        { return (enState == STATE_NAME) ? sName : NULL;        }
                bool set_name(const char *alias);
                bool set_name(const char *alias, size_t len);
                void clear_name();

                uint32_t rgb24() const noexcept;
                uint64_t rgb48() const noexcept;
                inline uint32_t regular() const noexcept        { return rgb24();                                       }
                inline uint32_t wide() const noexcept           { return rgb48();                                       }
                bool get(lsp::Color & color) const noexcept;
                bool get(lsp::Color * color) const noexcept;

                void set_rgb24(uint32_t v) noexcept;
                void set_rgb48(uint64_t v) noexcept;
                inline void set_regular(uint32_t v) noexcept    { set_rgb24(v);                                         }
                inline void set_wide(uint64_t v) noexcept       { set_rgb48(v);                                         }
                inline bool set_none() noexcept                 { return set_name("None");                              }

                bool set(const ColorItem & src);
                void reset();

                void swap(ColorItem & src) noexcept;
                void swap(ColorItem * src) noexcept;

        };

    } /* namespace xpm */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_XPM_COLORITEM_H_ */
