/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_I18N_DICTIONARY_H_
#define LSP_PLUG_IN_I18N_DICTIONARY_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/i18n/IDictionary.h>
#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/resource/ILoader.h>

namespace lsp
{
    namespace i18n
    {
        /**
         * Class implements root dictionary logic which operates on all
         * sub-dictionaries
         */
        class Dictionary: public IDictionary
        {
            private:
                Dictionary & operator = (const Dictionary &);

            protected:
                typedef struct node_t
                {
                    LSPString               sKey;
                    IDictionary            *pDict;
                    bool                    bRoot;
                } node_t;

            protected:
                lltl::parray<node_t>    vNodes;
                LSPString               sPath;
                resource::ILoader      *pLoader;

            protected:
                status_t            load_json(IDictionary **dict, const io::Path *path);
                status_t            create_child(IDictionary **dict, const LSPString *path);
                status_t            load_dictionary(const LSPString *id, IDictionary **dict);

            public:
                explicit Dictionary(resource::ILoader *loader = NULL);
                virtual ~Dictionary();

            public:
                inline resource::ILoader       *loader()        {  return pLoader;             }
                resource::ILoader              *set_loader();

            public:
                using IDictionary::lookup;
                using IDictionary::init;

                virtual status_t    lookup(const LSPString *key, LSPString *value);

                virtual status_t    lookup(const LSPString *key, IDictionary **value);

                virtual status_t    get_value(size_t index, LSPString *key, LSPString *value);

                virtual status_t    get_child(size_t index, LSPString *key, IDictionary **dict);

                virtual size_t      size();

                virtual status_t    init(const LSPString *path);

            public:
                /**
                 * Clear dictionary contents
                 */
                void        clear();

        };

    } /* namespace i18n */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_I18N_DICTIONARY_H_ */
