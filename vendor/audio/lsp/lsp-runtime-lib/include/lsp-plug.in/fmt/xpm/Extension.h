/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 22 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_FMT_XPM_EXTENSION_H_
#define LSP_PLUG_IN_FMT_XPM_EXTENSION_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/fmt/xpm/ColorItem.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * XPM3 extension
         */
        class LSP_RUNTIME_LIB_PUBLIC Extension
        {
            private:
                char       *sName;
                lltl::parray<char> vData;

            private:
                static bool         copy(lltl::parray<char> & dst, const lltl::parray<char> & src);
                static void         destroy(lltl::parray<char> & src);

            public:
                Extension() noexcept;
                explicit Extension(const char * name);
                Extension(const char * name, size_t len);
                Extension(const Extension & src);
                Extension(Extension && src) noexcept;
                ~Extension();

                Extension & operator = (const Extension & src);
                Extension & operator = (Extension && src) noexcept;

            public:
                inline const char *name() const noexcept        { return sName;             }
                bool set_name(const char *name);
                bool set_name(const char *name, size_t len);
                void clear_name();
                bool has_name(const char *name) const noexcept;

                inline size_t rows() const noexcept             { return vData.size();      }
                inline const char *row(size_t i) const noexcept { return vData.get(i);      }
                bool add_row(const char *row);
                bool add_row(const char *row, size_t len);
                inline void clear_rows()                        { destroy(vData);           }

                bool set(const Extension & src);

            public:
                void swap(Extension & src) noexcept;
                void swap(Extension * src) noexcept;
        };

    } /* namespace xpm */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_XPM_EXTENSION_H_ */
