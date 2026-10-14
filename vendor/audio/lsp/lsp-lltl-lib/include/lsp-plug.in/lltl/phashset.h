/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 31 июл. 2020 г.
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

#ifndef LSP_PLUG_IN_LLTL_PHASHSET_H_
#define LSP_PLUG_IN_LLTL_PHASHSET_H_

#include <lsp-plug.in/lltl/version.h>
#include <lsp-plug.in/lltl/iterator.h>
#include <lsp-plug.in/lltl/types.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace lltl
    {
        struct LSP_LLTL_LIB_PUBLIC raw_phashset
        {
            public:
                static const iter_vtbl_t    iterator_vtbl;

            public:
                typedef struct tuple_t
                {
                    size_t      hash;       // Hash code
                    void       *value;      // Value
                    tuple_t    *next;       // Next tuple
                } tuple_t;

                typedef struct bin_t
                {
                    size_t      size;       // Number of used tuples in storage
                    tuple_t    *data;       // Tuples
                } bin_t;

            public:
                size_t          size;       // Overall size of the hash
                size_t          cap;        // Capacity in bins
                bin_t          *bins;       // Overall array of bins
                size_t          vsize;      // Size of value object
                hash_iface      hash;       // Hash interface
                compare_iface   cmp;        // Copy interface

            protected:
                void            destroy_bin(bin_t *bin);
                bool            grow();
                tuple_t        *find_tuple(const void *value, size_t hash);
                tuple_t        *remove_tuple(const void *value, size_t hash);
                tuple_t        *create_tuple(size_t hash);
                static tuple_t *prev_tuple(bin_t *bin, const tuple_t *tuple);

            public:
                void            flush();
                void            clear();
                void            swap(raw_phashset *src);
                void           *get(const void *value, void *dfl);
                void          **wbget(const void *value);
                void          **put(void *value, void **ret);
                void          **create(void *value);
                bool            toggle(void *value);
                bool            remove(const void *value, void **ret);
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
        class phashset
        {
            private:
                mutable raw_phashset    v;

                inline static V *vcast(void *ptr)       { return static_cast<V *>(ptr);             }
                inline static V **pvcast(void *ptr)     { return reinterpret_cast<V **>(ptr);       }
                inline static void **pvcast(V **ptr)    { return reinterpret_cast<void **>(ptr);    }

            public:
                explicit inline phashset()
                {
                    hash_spec<V>        hash;
                    compare_spec<V>     cmp;

                    v.size          = 0;
                    v.cap           = 0;
                    v.bins          = NULL;
                    v.vsize         = sizeof(V);
                    v.hash          = hash;
                    v.cmp           = cmp;
                }

                explicit inline phashset(hash_iface hash, compare_iface cmp)
                {
                    v.size          = 0;
                    v.cap           = 0;
                    v.bins          = NULL;
                    v.vsize         = sizeof(V);
                    v.hash          = hash;
                    v.cmp           = cmp;
                }

                phashset(const phashset<V> & src) = delete;
                phashset(phashset<V> && src) = delete;
                ~phashset()                                             { v.flush();                                                    }

                phashset<V> & operator = (const phashset<V> & src) = delete;
                phashset<V> & operator = (phashset<V> && src) = delete;

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
                inline void swap(phashset<V> &src)                      { v.swap(&src.v);                                               }

                /**
                 * Performs internal data exchange with another collection of the same type
                 * @param src collection to perform exchange
                 */
                inline void swap(phashset<V> *src)                      { v.swap(&src->v);                                              }

            public:
                /**
                 * Check that value associated with key exists (same to contains)
                 * @param value the desired value
                 * @return true if value exists
                 */
                inline bool exists(const V *value) const                { return v.wbget(value) != NULL;                                }

                /**
                 * Check that value associated with key exists (same to exists)
                 * @param value the desired value
                 * @return true if value exists
                 */
                inline bool contains(const V *value) const              { return v.wbget(value) != NULL;                                }

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
                inline V *dget(const V *value, V *dfl) const            { return vcast(v.get(value, dfl));                                }

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
                 * @param ov value removed from hash
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **put(V *value, V **ov = NULL)                 { return pvcast(v.put(value, pvcast(ov)));                      }

                /**
                 * Create the value, do nothing if there is already existing value
                 * @param value value to use
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **create(V *value)                             { return pvcast(v.create(value));                               }

                /**
                 * Remove the associated key
                 * @param value the value to use for search
                 * @param ov value removed from set
                 * @return true if the data has been removed
                 */
                inline bool remove(const V *value, V **ov = NULL)       { return v.remove(value, pvcast(ov));               }

            public:
                /**
                 * Store all values to the destination array
                 * @param vv array to store values
                 * @return true if all keys have been successfully stored
                 */
                inline bool values(parray<V> *vv)                        { return v.values(vv->raw());                      }

            public:
                // Iterators
                inline iterator<V> values()                             { return iterator<V>(v.iter(&raw_phashset::iterator_vtbl));     }
                inline iterator<V> rvalues()                            { return iterator<V>(v.riter(&raw_phashset::iterator_vtbl));    }

                inline iterator<const V> values() const                 { return iterator<const V>(v.iter(&raw_phashset::iterator_vtbl));   }
                inline iterator<const V> rvalues() const                { return iterator<const V>(v.riter(&raw_phashset::iterator_vtbl));  }

        };
    } /* namespace lltl */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_LLTL_PHASHSET_H_ */
