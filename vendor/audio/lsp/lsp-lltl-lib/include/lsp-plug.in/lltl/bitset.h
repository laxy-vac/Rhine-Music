/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 30 июл. 2020 г.
 *
 * lsp-lltl-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-lltl-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-lltl-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_LLTL_BITSET_H_
#define LSP_PLUG_IN_LLTL_BITSET_H_

#include <lsp-plug.in/lltl/version.h>
#include <lsp-plug.in/lltl/types.h>
#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace lltl
    {
        class LSP_LLTL_LIB_PUBLIC bitset
        {
            protected:
                size_t          nSize;
                size_t          nCapacity;
                umword_t       *vData;

            public:
                explicit        bitset();
                bitset(const bitset &) = delete;
                bitset(bitset &&) = delete;
                ~bitset();

                bitset &operator = (const bitset &) = delete;
                bitset &operator = (bitset &&) = delete;

            public:
                inline bool     is_empty() const            { return nSize == 0;                    }
                inline size_t   size() const                { return nSize;                         }
                inline size_t   capacity() const            { return nCapacity * sizeof(umword_t);  }

            public:
                bool            resize(size_t size);
                void            flush();
                void            clear();

            public:
                bool            get(size_t index) const;

                void            set_all();
                bool            set(size_t index);
                bool            set(size_t index, bool value);
                size_t          set(size_t index, size_t count);
                size_t          set(size_t index, size_t count, const bool *values);

                void            unset_all();
                bool            unset(size_t index);
                size_t          unset(size_t index, size_t count);

                void            toggle_all();
                bool            toggle(size_t index);
                size_t          toggle(size_t index, size_t count);

            public:
                void            swap(bitset *dst);
        };

    } /* namespace lltl */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_LLTL_BITSET_H_ */
