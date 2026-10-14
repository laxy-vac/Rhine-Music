/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 26 февр. 2020 г.
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

#ifndef LSP_PLUG_IN_I18N_IDICTIONARY_H_
#define LSP_PLUG_IN_I18N_IDICTIONARY_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/Path.h>

namespace lsp
{
    namespace i18n
    {
        class IDictionary
        {
            private:
                IDictionary & operator = (const IDictionary &);

            public:
                explicit IDictionary();
                virtual ~IDictionary();

            public:
                /**
                 * Initialize dictionary
                 * @param path the location of the dictionary
                 * @return status of operation
                 */
                virtual status_t init(const char *path);

                /**
                 * Initialize dictionary
                 * @param path the location of the dictionary
                 * @return status of operation
                 */
                virtual status_t init(const LSPString *path);

                /**
                 * Initialize dictionary
                 * @param path the location of the dictionary
                 * @return status of operation
                 */
                virtual status_t init(const io::Path *path);

                /**
                 * Lookup for a key
                 * @param key non-null UTF-8 encoded key value
                 * @param value pointer to store the value (may be NULL)
                 * @return status of operation
                 */
                virtual status_t lookup(const char *key, LSPString *value);

                /**
                 * Lookup for a key
                 * @param key non-null key value
                 * @param value pointer to store the value (may be NULL)
                 * @return status of operation
                 */
                virtual status_t lookup(const LSPString *key, LSPString *value);

                /**
                 * Lookup for a dictionary
                 * @param key non-null UTF-8 encoded key value
                 * @param value pointer to store the value (may be NULL)
                 * @return status of operation
                 */
                virtual status_t lookup(const char *key, IDictionary **value);

                /**
                 * Lookup for a dictionary
                 * @param key non-null key value
                 * @param value pointer to store the value (may be NULL)
                 * @return status of operation
                 */
                virtual status_t lookup(const LSPString *key, IDictionary **value);

                /**
                 * Get the element by index of element
                 * @param index index of the element
                 * @param key the key name
                 * @param value pointer to store the value
                 * @return status of operation
                 */
                virtual status_t get_value(size_t index, LSPString *key, LSPString *value);

                /**
                 * Get the child dictionary by index of element
                 * @param index index of the element
                 * @param key the key name
                 * @param dict dictionary to return
                 * @return pointer to child dictionary or NULL if there is no such child
                 */
                virtual status_t get_child(size_t index, LSPString *key, IDictionary **dict);

                /**
                 * Return size of dictionary in elements
                 * @return size of dictionary in elements
                 */
                virtual size_t size();
        };
    }

} /* namespace lsp */

#endif /* LSP_PLUG_IN_I18N_IDICTIONARY_H_ */
