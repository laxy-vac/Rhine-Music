/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 12 нояб. 2023 г.
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

#ifndef LSP_PLUG_IN_LLTL_PTRSET_H_
#define LSP_PLUG_IN_LLTL_PTRSET_H_

#include <lsp-plug.in/lltl/version.h>
#include <lsp-plug.in/lltl/iterator.h>
#include <lsp-plug.in/lltl/types.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace lltl
    {
        constexpr size_t ptrset_tuple_items             = 16;

        struct LSP_LLTL_LIB_PUBLIC raw_ptrset
        {
            public:
                static const iter_vtbl_t    iterator_vtbl;

            public:
                typedef struct bin_t
                {
                    size_t      size;                       // Number of used tuples in storage
                    size_t      cap;                        // Capacity
                    void      **data;                       // Sorted list of elements
                } bin_t;

            public:
                size_t          size;       // Overall size of the hash
                size_t          cap;        // Capacity in bins
                bin_t          *bins;       // Overall array of bins
                hash_iface      hash;       // Hash interface

            protected:
                void            destroy_bin(bin_t *bin);
                bool            grow();
                bin_t          *next_bin(bin_t *bin);
                bin_t          *prev_bin(bin_t *bin);

                static ssize_t  index_of(const bin_t *bin, const void *value);
                static ssize_t  insert_index_of(const bin_t *bin, const void *value);
                static size_t   toggle_index_of(const bin_t *bin, const void *value);
                static bool     insert(bin_t *bin, void *value, size_t index);
                static bool     append(bin_t *bin, void *value);
                static void     remove(bin_t *bin, size_t index);

            public:
                void            flush();
                void            clear();
                void            swap(raw_ptrset *src);
                void           *get(const void *value, void *dfl);
                bool            contains(const void *value);
                bool            put(void *value);
                bool            toggle(void *value);
                bool            remove(const void *value);
                bool            values(raw_parray *v);
                void           *any();

            public:
                raw_iterator    iter(const iter_vtbl_t *vtbl);
                raw_iterator    riter(const iter_vtbl_t *vtbl);

            public:
                static void     iter_move(raw_iterator *i, ssize_t n);
                static void    *iter_get(raw_iterator *i);
                static ssize_t  iter_compare(const raw_iterator *a, const raw_iterator *b);
                static size_t   iter_count(const raw_iterator *i);
        };

        /**
         * Raw pointer implementation of hash set.
         * There are no automatic memory management for values, so the caller is required to
         * properly collect the garbage.
         */
        template <class V>
        class ptrset
        {
            private:
                mutable raw_ptrset  v;

//                using PV = typename lsp::remove_const<V>::type;

                inline static V *vcast(void *ptr)       { return static_cast<V *>(ptr);             }
                inline static V **pvcast(void *ptr)     { return reinterpret_cast<V **>(ptr);       }
                inline static void **pvcast(V **ptr)    { return reinterpret_cast<void **>(ptr);    }
//                inline static PV *ccast(PV *ptr)        { return ptr;                               }
//                inline static PV *ccast(const PV *ptr)  { return const_cast<PV *>(ptr);             }

            public:
                explicit inline ptrset()
                {
                    hash_spec<void *>       hash;

                    v.size          = 0;
                    v.cap           = 0;
                    v.bins          = NULL;
                    v.hash          = hash;
                }

                explicit inline ptrset(hash_iface hash)
                {
                    v.size          = 0;
                    v.cap           = 0;
                    v.bins          = NULL;
                    v.hash          = hash;
                }

                ptrset(const ptrset<V> &src) = delete;
                ptrset(ptrset<V> && src) = delete;

                ~ptrset()                                               { v.flush();                                                    }

                ptrset<V> & operator = (const ptrset<V> & src) = delete;
                ptrset<V> & operator = (ptrset<V> && src) = delete;

            public:
                /**
                 * Get number of stored elements in collection
                 * @return number of stored elements in collection
                 */
                inline size_t       size() const                        { return v.size;                                                }

                /**
                 * Get number of bins in collection
                 * @return number of bins in collection
                 */
                inline size_t       capacity() const                    { return v.cap;                                                 }

                /**
                 * Check whether collection is empty
                 * @return true if collection does not contain any element
                 */
                inline bool         is_empty() const                    { return v.size <= 0;                                           }

            public:
                /**
                 * Clear all bin data.
                 * Automatically destroys keys.
                 * Caller is responsible for destroying values.
                 */
                void clear()                                            { v.clear();                                                    }

                /**
                 * Clear and destroy all bins.
                 * Automatically destroys keys.
                 * Caller is responsible for destroying values.
                 */
                inline void flush()                                     { v.flush();                                                    }

                /**
                 * Performs internal data exchange with another collection of the same type
                 * @param src collection to perform exchange
                 */
                inline void swap(ptrset<V> &src)                        { v.swap(&src.v);                                               }

                /**
                 * Performs internal data exchange with another collection of the same type
                 * @param src collection to perform exchange
                 */
                inline void swap(ptrset<V> *src)                        { v.swap(&src->v);                                              }

            public:
                /**
                 * Check that value associated with key exists (same to contains)
                 * @param value the desired value
                 * @return true if value exists
                 */
                inline bool exists(const V *value) const                { return v.contains(value);                                     }

                /**
                 * Check that value associated with key exists (same to exists)
                 * @param value the desired value
                 * @return true if value exists
                 */
                inline bool contains(const V *value) const              { return v.contains(value);                                     }

                /**
                 * Get value by key
                 * @param value the desired value
                 * @return associated value or NULL if not exists
                 */
                inline V *get(const V *value) const                     { return vcast(v.get(value, NULL));                             }

                /**
                 * Get value by key or return default value if the value was not found
                 * @param value the desired value
                 * @param dfl default value to return if there is no such value in the set
                 * @return the associated value or default value if not exists
                 */
                inline V *dget(const V *value, V *dfl) const            { return vcast(v.get(value, dfl));                              }

                /**
                 * Remove the item from set if it is present in the set, add the item if not
                 * @param value value to toggle
                 * @return true on success
                 */
                inline bool toggle(V *value) const                      { return v.toggle(value);                                       }

                /**
                 * Get any single value present in the collection
                 * @return any value present in the collection or NULL if none
                 */
                inline V *any() const                                   { return vcast(v.any());                                        }

            public:
                /**
                 * Put the value to the set
                 * @param value value to put
                 * @return true if value was not present in the set previously
                 */
                inline bool put(V *value)                               { return v.put(lsp::unconst_ptr(value));                        }

                /**
                 * Remove the pointer from set
                 * @param value the value to remove
                 * @return true if the pointer has been removed
                 */
                inline bool remove(const V *value)                      { return v.remove(value);                                       }

            public:
                /**
                 * Store all values to the destination array
                 * @param vv array to store values
                 * @return true if all keys have been successfully stored
                 */
                inline bool values(parray<V> *vv)                        { return v.values(vv->raw());                      }

            public:
                // Iterators
                inline iterator<V> values()                             { return iterator<V>(v.iter(&raw_ptrset::iterator_vtbl));     }
                inline iterator<V> rvalues()                            { return iterator<V>(v.riter(&raw_ptrset::iterator_vtbl));    }

                inline iterator<const V> values() const                 { return iterator<const V>(v.iter(&raw_ptrset::iterator_vtbl));     }
                inline iterator<const V> rvalues() const                { return iterator<const V>(v.riter(&raw_ptrset::iterator_vtbl));    }

        };
    } /* namespace lltl */
} /* namespace lsp */




#endif /* LSP_PLUG_IN_LLTL_PTRSET_H_ */
