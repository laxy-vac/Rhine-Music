/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 10 мая 2020 г.
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

#ifndef LSP_PLUG_IN_LLTL_PPHASH_H_
#define LSP_PLUG_IN_LLTL_PPHASH_H_

#include <lsp-plug.in/lltl/version.h>
#include <lsp-plug.in/lltl/iterator.h>
#include <lsp-plug.in/lltl/types.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace lltl
    {
        struct LSP_LLTL_LIB_PUBLIC raw_pphash
        {
            public:
                static const iter_vtbl_t    key_iterator_vtbl;
                static const iter_vtbl_t    value_iterator_vtbl;
                static const iter_vtbl_t    pair_iterator_vtbl;

            public:
                typedef struct tuple_t
                {
                    size_t      hash;       // Hash code
                    raw_pair_t  v;          // Contained key-value pair
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
                size_t          ksize;      // Size of key object
                hash_iface      hash;       // Hash interface
                compare_iface   cmp;        // Copy interface
                allocator_iface alloc;      // Allocator interface

            protected:
                void            destroy_bin(bin_t *bin);
                bool            grow();
                tuple_t        *find_tuple(const void *key, size_t hash);
                tuple_t        *remove_tuple(const void *key, size_t hash);
                tuple_t        *create_tuple(const void *key, size_t hash);
                static tuple_t *prev_tuple(bin_t *bin, const tuple_t *tuple);

            public:
                void            flush();
                void            clear();
                void            swap(raw_pphash *src);
                void           *get(const void *key, void *dfl);
                void           *key(const void *key, void *dfl);
                void          **wbget(const void *key);
                void          **put(const void *key, void *value, void **ov);
                void          **replace(const void *key, void *value, void **ov);
                void          **create(const void *key, void *value);
                bool            remove(const void *key, void **ov);
                bool            keys(raw_parray *k) const;
                bool            values(raw_parray *v) const;
                bool            items(raw_parray *k, raw_parray *v) const;

            public:
                raw_iterator    iter(const iter_vtbl_t *vtbl);
                raw_iterator    riter(const iter_vtbl_t *vtbl);

            public:
                static void     iter_move(raw_iterator *i, ssize_t n);
                static void    *iter_get_key(raw_iterator *i);
                static void    *iter_get_value(raw_iterator *i);
                static void    *iter_get_pair(raw_iterator *i);
                static ssize_t  iter_compare(const raw_iterator *a, const raw_iterator *b);
                static size_t   iter_count(const raw_iterator *i);
        };


        /**
         * Raw pointer implementation of key-value hash map.
         * Keys are automatically managed by the hash interface.
         */
        template <class K, class V>
        class pphash
        {
            private:
                mutable raw_pphash    v;

                inline static K *kcast(void *ptr)       { return static_cast<K *>(ptr);             }
                inline static V *vcast(void *ptr)       { return static_cast<V *>(ptr);             }
                inline static V **pvcast(void *ptr)     { return reinterpret_cast<V **>(ptr);       }
                inline static K **pkcast(void *ptr)     { return reinterpret_cast<K **>(ptr);       }
                inline static void **pvcast(V **ptr)    { return reinterpret_cast<void **>(ptr);    }
                inline static void **pkcast(K **ptr)    { return reinterpret_cast<void **>(ptr);    }

            public:
                explicit inline pphash()
                {
                    hash_spec<K>        hash;
                    compare_spec<K>     cmp;
                    allocator_spec<K>   alloc;

                    v.size          = 0;
                    v.cap           = 0;
                    v.bins          = NULL;
                    v.ksize         = sizeof(K);
                    v.hash          = hash;
                    v.cmp           = cmp;
                    v.alloc         = alloc;
                }

                explicit inline pphash(hash_iface hash, compare_iface cmp, allocator_iface alloc)
                {
                    v.size          = 0;
                    v.cap           = 0;
                    v.bins          = NULL;
                    v.ksize         = sizeof(K);
                    v.hash          = hash;
                    v.cmp           = cmp;
                    v.alloc         = alloc;
                }

                pphash(const pphash<K, V> & src) = delete;
                pphash(pphash<K, V> && src) = delete;
                pphash<K, V> & operator = (const pphash<K, V> & src) = delete;
                pphash<K, V> & operator = (pphash<K, V> && src) = delete;

                ~pphash()                                               { v.flush();                                                    }

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
                inline void swap(pphash<K, V> &src)                     { v.swap(&src.v);                                                }

                /**
                 * Performs internal data exchange with another collection of the same type
                 * @param src collection to perform exchange
                 */
                inline void swap(pphash<K, V> *src)                     { v.swap(&src->v);                                               }

            public:
                /**
                 * Check that value associated with key exists (same to contains)
                 * @param key key
                 * @return true if value exists
                 */
                inline bool exists(const K *key) const                  { return v.wbget(key) != NULL;                                   }

                /**
                 * Check that value associated with key exists (same to exists)
                 * @param key key
                 * @return true if value exists
                 */
                inline bool contains(const K *key) const                { return v.wbget(key) != NULL;                                   }

                /**
                 * Get pointer to the key in the storage
                 * @param key key to use
                 * @return associated key in the storage or NULL if not exists
                 */
                inline K *key(const K *key) const                       { return kcast(v.key(key, NULL));                                }

                /**
                 * Get value by key
                 * @param key key to use
                 * @return associated value or NULL if not exists
                 */
                inline V *get(const K *key) const                       { return vcast(v.get(key, NULL));                               }

                /**
                 * Get value by key or return default value if the value in hash was not found
                 * @param key key to use
                 * @param dfl default value to return if there is no such key in the hash
                 * @return the associated value
                 */
                inline V *dget(const K *key, V *dfl) const              { return vcast(v.get(key, dfl));                                }

                /**
                 * Get value for writing
                 * @param key the key to lookup the value
                 * @return pointer to the associated value that can be overwritten
                 */
                inline V **wbget(const K *key)                          { return pvcast(v.wbget(key));                                  }

            public:
                /**
                 * Put the value to the hash
                 * @param key key to use
                 * @param value value to put
                 * @param ov value removed from hash
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **put(const K *key, V *value, V **ov)          { return pvcast(v.put(key, value, pvcast(ov)));     }

                /**
                 * Put the value to the hash
                 * @param key key to use
                 * @param ov value removed from hash
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **put(const K *key, V **ov)                    { return pvcast(v.put(key, NULL, pvcast(ov)));      }

                /**
                 * Create the entry, do nothing if there is already existing entry with such key
                 * @param key key to use
                 * @param value value to use
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **create(const K *key, V *value)               { return pvcast(v.create(key, value));                          }

                /**
                 * Create the entry, do nothing if there is already existing entry with such key
                 * @param key key to use
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **create(const K *key)                         { return pvcast(v.create(key, NULL));                           }

                /**
                 * Replace the entry ONLY if it exists
                 * @param key key to use
                 * @param value value to use
                 * @param ov value removed from hash
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **replace(const K *key, V *value, V **ov)      { return pvcast(v.replace(key, value, pvcast(ov))); }

                /**
                 * Replace the entry ONLY if it exists
                 * @param key key to use
                 * @param ov old value removed from hash
                 * @return pointer to write data or NULL if no allocation possible
                 */
                inline V **replace(const K *key, V **ov)                { return pvcast(v.replace(key, NULL, pvcast(ov)));  }

                /**
                 * Remove the associated key
                 * @param key the key to use for seacrh
                 * @param ov value removed from hash
                 * @return true if the data has been removed
                 */
                inline bool remove(const K *key, V **ov)                { return v.remove(key, pvcast(ov));                 }

            public:
                /**
                 * Store all keys to destination array
                 * @param vk array to store keys
                 * @return true if all keys have been successfully stored
                 */
                inline bool keys(parray<K> *vk) const                    { return v.keys(vk->raw());                        }

                /**
                 * Store all values to destination array
                 * @param vv array to store values
                 * @return true if all keys have been successfully stored
                 */
                inline bool values(parray<V> *vv) const                  { return v.values(vv->raw());                      }

                /**
                 * Store all items to destination array
                 * @param vk array to store keys
                 * @param vv array to store values
                 * @return true if all keys have been successfully stored
                 */
                inline bool items(parray<K> *vk, parray<V> *vv) const   { return v.items(vk->raw(), vv->raw());            }

            public:
                // Iterators
                inline iterator<K> keys()                               { return iterator<K>(v.iter(&raw_pphash::key_iterator_vtbl));       }
                inline iterator<K> rkeys()                              { return iterator<K>(v.riter(&raw_pphash::key_iterator_vtbl));      }
                inline iterator<const K> keys() const                   { return iterator<const K>(v.iter(&raw_pphash::key_iterator_vtbl));       }
                inline iterator<const K> rkeys() const                  { return iterator<const K>(v.riter(&raw_pphash::key_iterator_vtbl));      }

                inline iterator<V> values()                             { return iterator<V>(v.iter(&raw_pphash::value_iterator_vtbl));     }
                inline iterator<V> rvalues()                            { return iterator<V>(v.riter(&raw_pphash::value_iterator_vtbl));    }
                inline iterator<const V> values() const                 { return iterator<const V>(v.iter(&raw_pphash::value_iterator_vtbl));     }
                inline iterator<const V> rvalues() const                { return iterator<const V>(v.riter(&raw_pphash::value_iterator_vtbl));    }

                inline iterator<pair<K, V>> items()                     { return iterator<pair<K, V>>(v.iter(&raw_pphash::pair_iterator_vtbl));      }
                inline iterator<pair<K, V>> ritems()                    { return iterator<pair<K, V>>(v.riter(&raw_pphash::pair_iterator_vtbl));     }
                inline iterator<pair<const K, const V>> items() const   { return iterator<pair<const K, const V>>(v.iter(&raw_pphash::pair_iterator_vtbl));      }
                inline iterator<pair<const K, const V>> ritems() const  { return iterator<pair<const K, const V>>(v.riter(&raw_pphash::pair_iterator_vtbl));     }
        };
    } /* namespace lltl */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_LLTL_PPHASH_H_ */
